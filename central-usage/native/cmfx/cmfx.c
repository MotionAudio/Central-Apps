/* cmfx.c - Central FX: reads a plugin made in the plugin builder (cmfx.h) and plays it.
 * The graph's blocks run in wiring order, 128 samples at a time; every signal on a wire is stereo. A control input
 * (a block's knob: freq, mix, time...) takes the number in the block's props, or a plugin knob ({"param":"id"}), or
 * whatever is wired into it (an LFO, an envelope, maths, a knob block...). */
#include "cmfx.h"
#include "cmfx_int.h"

enum { B_INPUT, B_OUTPUT, B_GAIN, B_MIX, B_FILTER, B_EQ, B_DELAY, B_REVERB, B_CHORUS, B_PHASER, B_DRIVE, B_CRUSH, B_COMP, B_LIMIT,
  B_GATE, B_TREMOLO, B_PITCH, B_LFO, B_ENV, B_MATH, B_PARAM, B_CODE, B_STEREO, B_NTYPES };
typedef struct { const char *name; int audio; float def, lo, hi; } PortSpec;
typedef struct {
  const char *type; int nPorts; PortSpec ports[CM_MAXPORTS]; int hasOut;
  const char *e1; const char *const *v1; const char *e2; const char *const *v2;   /* up to two choices (mode, shape...) */
} TypeSpec;
static const char *const FILTER_MODES[] = { "lowpass", "highpass", "bandpass", "notch", "peak", "lowshelf", "highshelf", "allpass", 0 };
static const char *const EQ_MODES[] = { "peak", "lowshelf", "highshelf", "lowpass", "highpass", "bandpass", "notch", "allpass", 0 };
static const char *const MIX_LAW[] = { "linear", "equal", 0 };
static const char *const DELAY_MODES[] = { "normal", "pingpong", 0 };
static const char *const CHORUS_MODES[] = { "chorus", "flanger", 0 };
static const char *const DRIVE_MODES[] = { "soft", "hard", "tube", "fuzz", "fold", 0 };
static const char *const TREM_MODES[] = { "tremolo", "autopan", 0 };
static const char *const SHAPES[] = { "sine", "triangle", "saw", "ramp", "square", "random", 0 };
static const char *const MATH_OPS[] = { "add", "subtract", "multiply", "divide", "min", "max", "abs", "negate", "clamp", "map", "db2gain", "gain2db", "sin", "tanh", "value", "smooth", 0 };
static const char *const STEREO_MODES[] = { "normal", "mono", "swap", 0 };
#define A(n) { n, 1, 0, -1e9f, 1e9f }
static const TypeSpec TYPES[B_NTYPES] = {
  { "input", 0, { { 0 } }, 1, 0, 0, 0, 0 },
  { "output", 1, { A("in") }, 0, 0, 0, 0, 0 },
  { "gain", 2, { A("in"), { "gain", 0, 0, -60, 24 } }, 1, 0, 0, 0, 0 },
  { "mix", 3, { A("dry"), A("wet"), { "mix", 0, 0.5f, 0, 1 } }, 1, "law", MIX_LAW, 0, 0 },
  { "filter", 4, { A("in"), { "freq", 0, 1000, 10, 22000 }, { "q", 0, 0.707f, 0.1f, 30 }, { "gain", 0, 0, -24, 24 } }, 1, "mode", FILTER_MODES, 0, 0 },
  { "eq", 4, { A("in"), { "freq", 0, 1000, 10, 22000 }, { "q", 0, 1, 0.1f, 30 }, { "gain", 0, 0, -24, 24 } }, 1, "mode", EQ_MODES, 0, 0 },
  { "delay", 5, { A("in"), { "time", 0, 350, 1, 10000 }, { "feedback", 0, 0.35f, 0, 0.98f }, { "mix", 0, 0.35f, 0, 1 }, { "tone", 0, 6000, 200, 20000 } }, 1, "mode", DELAY_MODES, 0, 0 },
  { "reverb", 6, { A("in"), { "size", 0, 0.6f, 0, 1 }, { "damp", 0, 0.4f, 0, 1 }, { "mix", 0, 0.3f, 0, 1 }, { "predelay", 0, 10, 0, 250 }, { "width", 0, 1, 0, 1 } }, 1, 0, 0, 0, 0 },
  { "chorus", 5, { A("in"), { "rate", 0, 0.8f, 0.01f, 10 }, { "depth", 0, 0.5f, 0, 1 }, { "feedback", 0, 0, -0.95f, 0.95f }, { "mix", 0, 0.5f, 0, 1 } }, 1, "mode", CHORUS_MODES, 0, 0 },
  { "phaser", 5, { A("in"), { "rate", 0, 0.5f, 0.01f, 10 }, { "depth", 0, 0.7f, 0, 1 }, { "feedback", 0, 0.3f, -0.95f, 0.95f }, { "mix", 0, 0.5f, 0, 1 } }, 1, 0, 0, 0, 0 },
  { "drive", 5, { A("in"), { "drive", 0, 12, 0, 48 }, { "tone", 0, 8000, 200, 20000 }, { "level", 0, -6, -48, 12 }, { "mix", 0, 1, 0, 1 } }, 1, "mode", DRIVE_MODES, 0, 0 },
  { "bitcrush", 4, { A("in"), { "bits", 0, 8, 1, 24 }, { "rate", 0, 12000, 200, 48000 }, { "mix", 0, 1, 0, 1 } }, 1, 0, 0, 0, 0 },
  { "compressor", 9, { A("in"), A("key"), { "threshold", 0, -18, -60, 0 }, { "ratio", 0, 4, 1, 30 }, { "attack", 0, 10, 0.1f, 200 }, { "release", 0, 120, 5, 2000 }, { "knee", 0, 6, 0, 24 }, { "makeup", 0, 0, -12, 24 }, { "mix", 0, 1, 0, 1 } }, 1, 0, 0, 0, 0 },
  { "limiter", 3, { A("in"), { "ceiling", 0, -1, -24, 0 }, { "release", 0, 80, 5, 1000 } }, 1, 0, 0, 0, 0 },
  { "gate", 7, { A("in"), A("key"), { "threshold", 0, -50, -90, 0 }, { "range", 0, -80, -90, 0 }, { "attack", 0, 1, 0.1f, 50 }, { "hold", 0, 40, 0, 500 }, { "release", 0, 120, 5, 2000 } }, 1, 0, 0, 0, 0 },
  { "tremolo", 4, { A("in"), { "rate", 0, 4, 0.05f, 20 }, { "depth", 0, 0.6f, 0, 1 }, { "stereo", 0, 0, 0, 180 } }, 1, "mode", TREM_MODES, "shape", SHAPES },
  { "pitch", 4, { A("in"), { "semitones", 0, 12, -24, 24 }, { "fine", 0, 0, -100, 100 }, { "mix", 0, 1, 0, 1 } }, 1, 0, 0, 0, 0 },
  { "lfo", 5, { { "rate", 0, 1, 0.01f, 40 }, { "from", 0, 0, -1e6f, 1e6f }, { "to", 0, 1, -1e6f, 1e6f }, { "phase", 0, 0, 0, 360 }, { "stereo", 0, 0, 0, 180 } }, 1, "shape", SHAPES, 0, 0 },
  { "envelope", 6, { A("in"), { "attack", 0, 10, 0.1f, 500 }, { "release", 0, 150, 1, 5000 }, { "sensitivity", 0, 0, -24, 24 }, { "from", 0, 0, -1e6f, 1e6f }, { "to", 0, 1, -1e6f, 1e6f } }, 1, 0, 0, 0, 0 },
  { "math", 8, { { "a", 0, 0, -1e9f, 1e9f }, { "b", 0, 0, -1e9f, 1e9f }, { "lo", 0, 0, -1e9f, 1e9f }, { "hi", 0, 1, -1e9f, 1e9f }, { "inLo", 0, 0, -1e9f, 1e9f }, { "inHi", 0, 1, -1e9f, 1e9f }, { "outLo", 0, 0, -1e9f, 1e9f }, { "outHi", 0, 1, -1e9f, 1e9f } }, 1, "op", MATH_OPS, 0, 0 },
  { "param", 0, { { 0 } }, 1, 0, 0, 0, 0 },
  { "code", 5, { A("in"), { "c1", 0, 0, -1e9f, 1e9f }, { "c2", 0, 0, -1e9f, 1e9f }, { "c3", 0, 0, -1e9f, 1e9f }, { "c4", 0, 0, -1e9f, 1e9f } }, 1, 0, 0, 0, 0 },
  { "stereo", 3, { A("in"), { "width", 0, 1, 0, 2 }, { "pan", 0, 0, -1, 1 } }, 1, "mode", STEREO_MODES, 0, 0 },
};

typedef struct { const float *p[2]; float k; } Sig;
static inline float sg(const Sig *s, int ch, int i) { return s->p[ch] ? s->p[ch][i] : s->k; }
static inline int sconst(const Sig *s) { return !s->p[0]; }
#define UND(x) do { if ((x) < 1e-18f && (x) > -1e-18f) (x) = 0; } while (0)
static inline float clampf(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }

typedef struct { float ic1[2][2], ic2[2][2]; double a1[2], a2[2], a3[2], m0[2], m1[2], m2[2]; float lf[2], lq[2], lg[2]; int stages, ok; } StFilter;
typedef struct { long len; int pos; float lp[2], ts[2]; int init; } StDelay;
typedef struct { int cl[2][8], cp[2][8], al[2][4], ap[2][4]; long co[2][8], ao[2][4]; float cs[2][8]; long pdLen, pdOff; int pdPos; } StReverb;
typedef struct { long len; int pos; double phase; } StChorus;
typedef struct { float z[2][12], fb[2]; double a[2]; double phase; int stages; } StPhaser;
typedef struct { float lp[2], x1[2], y1[2]; } StDrive;
typedef struct { float hold[2]; double phase; } StCrush;
typedef struct { float env; } StComp;
typedef struct { float g; } StLimit;
typedef struct { float env, g; int hold; } StGate;
typedef struct { double phase; } StTrem;
typedef struct { long len; int pos; double phase; } StPitch;
typedef struct { double phase; float cur, target; unsigned rng; } StLfo;
typedef struct { float env; } StEnv;
typedef struct { float sm[2]; } StMath;

typedef struct {
  int type, mode, mode2; char id[32]; float num[2];
  float konst[CM_MAXPORTS]; int bind[CM_MAXPORTS];          /* unwired: a number, or a plugin knob (index, -1 none) */
  int srcStart[CM_MAXPORTS], srcCount[CM_MAXPORTS];         /* wired: sources[srcStart .. +srcCount) */
  long sumOff[CM_MAXPORTS]; float *sum[CM_MAXPORTS];        /* several wires into one input: summed here (pool) */
  Sig in[CM_MAXPORTS];
  float out[2][CM_CHUNK];
  int prog, param;
  long bufOff; long bufLen; float *buf;
  union { StFilter f; StDelay d; StReverb r; StChorus c; StPhaser ph; StDrive dr; StCrush cr; StComp cp; StLimit lm; StGate g; StTrem t; StPitch p; StLfo l; StEnv e; StMath m; } st;
} Block;
typedef struct { char id[32], name[48], unit[16]; float min, max, def; int log; volatile float target; float cur; float buf[CM_CHUNK]; } Param;

struct CmFx {
  float sr; char name[64], author[64]; const char *status;
  Block blocks[CM_MAXBLOCKS]; int nBlocks; int order[CM_MAXBLOCKS];
  int sources[CM_MAXWIRES]; int nSources;
  Param params[CM_MAXPARAMS]; int nParams;
  CCode code;
  unsigned long pool; float *mem; int attached;
  float inBuf[2][CM_CHUNK];
  Json json;
};

unsigned long cmfx_struct_size(void) { return (unsigned long)sizeof(CmFx); }

/* ---------------------------------------------------------------- loading */
static int typeOf(const char *t) { if (!t) return -1; for (int i = 0; i < B_NTYPES; i++) if (cm_streq(TYPES[i].type, t)) return i; return -1; }
static int portOf(int type, const char *name) { for (int i = 0; i < TYPES[type].nPorts; i++) if (cm_streq(TYPES[type].ports[i].name, name)) return i; return -1; }
static int blockOf(CmFx *fx, const char *id) { for (int i = 0; i < fx->nBlocks; i++) if (cm_streq(fx->blocks[i].id, id)) return i; return -1; }
static int choice(const char *const *vals, const char *s) { if (!vals || !s) return -1; for (int i = 0; vals[i]; i++) if (cm_streq(vals[i], s)) return i; return -1; }
static void copyStr(char *d, int n, const char *s) { int i = 0; if (s) for (; s[i] && i < n - 1; i++) d[i] = s[i]; d[i] = 0; }
static int validId(const char *s) {
  if (!s || !s[0] || cm_strlen(s) > 31) return 0;
  for (int i = 0; s[i]; i++) { char c = s[i]; if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || (i && c >= '0' && c <= '9'))) return 0; }
  return 1;
}
static int validBlockId(const char *s) {
  if (!s || !s[0] || cm_strlen(s) > 31) return 0;
  for (int i = 0; s[i]; i++) { char c = s[i]; if (c == '.' || c == '"' || c < 0x21) return 0; }
  return 1;
}
static long poolTake(CmFx *fx, unsigned long n) { long o = (long)fx->pool; fx->pool += n; return o; }

static int paramIndex(CmFx *fx, const char *id) { for (int i = 0; i < fx->nParams; i++) if (cm_streq(fx->params[i].id, id)) return i; return -1; }

/* the memory each block needs (in floats), now that the sample rate is known */
static void planBuffers(CmFx *fx, Block *b) {
  float sr = fx->sr;
  switch (b->type) {
    case B_DELAY: { float mx = b->num[0] > 0 ? b->num[0] : 2000; if (mx > 10000) mx = 10000; b->st.d.len = (long)(mx * sr / 1000) + 4; b->bufLen = 2 * b->st.d.len; break; }
    case B_REVERB: {
      static const int comb[8] = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 }, ap[4] = { 556, 441, 341, 225 };
      double sc = sr / 44100.0; long total = 0;
      for (int ch = 0; ch < 2; ch++) {
        for (int j = 0; j < 8; j++) { int l = (int)((comb[j] + ch * 23) * sc); if (l < 2) l = 2; b->st.r.cl[ch][j] = l; b->st.r.co[ch][j] = total; total += l; }
        for (int j = 0; j < 4; j++) { int l = (int)((ap[j] + ch * 23) * sc); if (l < 2) l = 2; b->st.r.al[ch][j] = l; b->st.r.ao[ch][j] = total; total += l; }
      }
      b->st.r.pdLen = (long)(0.25f * sr) + 4; b->st.r.pdOff = total; total += b->st.r.pdLen; b->bufLen = total; break;
    }
    case B_CHORUS: b->st.c.len = (long)(0.06f * sr) + 4; b->bufLen = 2 * b->st.c.len; break;
    case B_PITCH: { float w = b->num[0] > 0 ? b->num[0] : 50; if (w < 10) w = 10; if (w > 200) w = 200; b->num[0] = w; b->st.p.len = (long)(w * sr / 1000 * 1.2f) + 8; b->bufLen = 2 * b->st.p.len; break; }
    default: b->bufLen = 0;
  }
  b->bufOff = b->bufLen ? poolTake(fx, (unsigned long)b->bufLen) : 0;
}

static int fail(char *err, int errLen, const char *m, const char *a) { cm_fmt(err, errLen, m, a); return -1; }

int cmfx_load(CmFx *fx, const char *text, int len, float sr, char *err, int errLen) {
  if (err && errLen) err[0] = 0;
  /* (keep the JSON area: it is big and only needed here) */
  Json *j = &fx->json;
  fx->sr = sr >= 8000 && sr <= 384000 ? sr : 48000; fx->status = 0; fx->nBlocks = 0; fx->nSources = 0; fx->nParams = 0; fx->pool = 0; fx->mem = 0; fx->attached = 0;
  fx->code.nOps = 0; fx->code.nVars = 0; fx->code.nProgs = 0; fx->code.nParams = 0; fx->name[0] = fx->author[0] = 0;
  int root = json_parse(j, text, len);
  if (root < 0) return fail(err, errLen, "%s", j->err);
  if (j->nodes[root].type != JN_OBJ) return fail(err, errLen, "the plugin file must be a JSON object%s", "");
  const char *format = json_str(j, json_get(j, root, "format"));
  if (!cm_streq(format, "central-fx")) return fail(err, errLen, "this isn't a Central FX plugin (its format should be \"central-fx\")%s", "");
  double ver = json_num(j, json_get(j, root, "version"), 1);
  if (ver > 1) return fail(err, errLen, "this plugin was made by a newer version of the plugin builder: update the app to play it%s", "");
  const char *name = json_str(j, json_get(j, root, "name"));
  if (!name || !name[0]) return fail(err, errLen, "the plugin needs a name%s", "");
  copyStr(fx->name, sizeof fx->name, name); copyStr(fx->author, sizeof fx->author, json_str(j, json_get(j, root, "author")));

  /* the knobs */
  int ps = json_get(j, root, "params");
  if (ps >= 0 && j->nodes[ps].type != JN_ARR) return fail(err, errLen, "params must be a list%s", "");
  if (ps >= 0) for (int n = j->nodes[ps].first; n >= 0; n = j->nodes[n].next) {
    if (fx->nParams >= CM_MAXPARAMS) return fail(err, errLen, "a plugin can have up to 32 knobs%s", "");
    if (j->nodes[n].type != JN_OBJ) return fail(err, errLen, "each knob must be an object%s", "");
    const char *id = json_str(j, json_get(j, n, "id"));
    if (!validId(id)) return fail(err, errLen, "a knob's id must be a short name of letters, numbers and _ (got \"%s\")", id ? id : "");
    if (paramIndex(fx, id) >= 0) return fail(err, errLen, "two knobs have the id %s", id);
    Param *p = &fx->params[fx->nParams];
    copyStr(p->id, sizeof p->id, id); const char *pn = json_str(j, json_get(j, n, "name")); copyStr(p->name, sizeof p->name, pn && pn[0] ? pn : id);
    copyStr(p->unit, sizeof p->unit, json_str(j, json_get(j, n, "unit")));
    p->min = (float)json_num(j, json_get(j, n, "min"), 0); p->max = (float)json_num(j, json_get(j, n, "max"), 1);
    if (!(p->max > p->min)) return fail(err, errLen, "the knob %s needs a max bigger than its min", id);
    p->def = clampf((float)json_num(j, json_get(j, n, "default"), p->min), p->min, p->max);
    const char *curve = json_str(j, json_get(j, n, "curve")); p->log = cm_streq(curve, "log") && p->min > 0;
    p->target = p->cur = p->def; for (int i = 0; i < CM_CHUNK; i++) p->buf[i] = p->def;
    copyStr(fx->code.paramIds[fx->nParams], 32, id);
    fx->nParams++;
  }
  fx->code.nParams = fx->nParams;

  /* the blocks */
  int graph = json_get(j, root, "graph"), blocks = json_get(j, graph, "blocks"), wires = json_get(j, graph, "wires");
  const char *wholeCode = json_str(j, json_get(j, root, "code"));
  int nb = 0; if (blocks >= 0 && j->nodes[blocks].type == JN_ARR) for (int n = j->nodes[blocks].first; n >= 0; n = j->nodes[n].next) nb++;
  if (!nb) {
    if (!wholeCode || !wholeCode[0]) return fail(err, errLen, "the plugin is empty: add blocks, or write code%s", "");
    /* the whole plugin is code: input -> code -> output */
    static const char *ids[3] = { "input", "code", "output" }; static const int types[3] = { B_INPUT, B_CODE, B_OUTPUT };
    for (int i = 0; i < 3; i++) { Block *b = &fx->blocks[i]; cm_memset(b, 0, sizeof *b); b->type = types[i]; copyStr(b->id, 32, ids[i]); b->prog = -1; b->param = -1; for (int k = 0; k < CM_MAXPORTS; k++) b->bind[k] = -1; }
    fx->nBlocks = 3;
    int pr = code_compile(&fx->code, wholeCode, cm_strlen(wholeCode), fx->sr, err, errLen); if (pr < 0) return -1;
    fx->blocks[1].prog = pr;
    for (int i = 0; i < TYPES[B_CODE].nPorts; i++) fx->blocks[1].konst[i] = TYPES[B_CODE].ports[i].def;
    fx->sources[0] = 0; fx->blocks[1].srcStart[0] = 0; fx->blocks[1].srcCount[0] = 1;
    fx->sources[1] = 1; fx->blocks[2].srcStart[0] = 1; fx->blocks[2].srcCount[0] = 1; fx->nSources = 2;
    fx->order[0] = 0; fx->order[1] = 1; fx->order[2] = 2;
  } else {
    if (j->nodes[blocks].type != JN_ARR) return fail(err, errLen, "graph.blocks must be a list%s", "");
    for (int n = j->nodes[blocks].first; n >= 0; n = j->nodes[n].next) {
      if (fx->nBlocks >= CM_MAXBLOCKS) return fail(err, errLen, "a plugin can have up to 64 blocks%s", "");
      if (j->nodes[n].type != JN_OBJ) return fail(err, errLen, "each block must be an object%s", "");
      const char *id = json_str(j, json_get(j, n, "id")), *type = json_str(j, json_get(j, n, "type"));
      if (!validBlockId(id)) return fail(err, errLen, "a block needs a short id without dots or spaces (got \"%s\")", id ? id : "");
      if (blockOf(fx, id) >= 0) return fail(err, errLen, "two blocks have the id %s", id);
      int t = typeOf(type); if (t < 0) return fail(err, errLen, "I don't know the block type \"%s\"", type ? type : "");
      Block *b = &fx->blocks[fx->nBlocks]; cm_memset(b, 0, sizeof *b); b->type = t; b->prog = -1; b->param = -1; copyStr(b->id, 32, id);
      int props = json_get(j, n, "props");
      for (int k = 0; k < CM_MAXPORTS; k++) b->bind[k] = -1;
      for (int k = 0; k < TYPES[t].nPorts; k++) {
        const PortSpec *ps2 = &TYPES[t].ports[k]; b->konst[k] = ps2->def;
        int v = json_get(j, props, ps2->name); if (v < 0) continue;
        if (j->nodes[v].type == JN_NUM) b->konst[k] = clampf((float)j->nodes[v].num, ps2->lo, ps2->hi);
        else if (j->nodes[v].type == JN_OBJ) {
          const char *pid = json_str(j, json_get(j, v, "param")); int pi = pid ? paramIndex(fx, pid) : -1;
          if (pi < 0) { char m[120]; cm_fmt(m, sizeof m, "%s's %s uses a knob that isn't there (", id, ps2->name); int l = cm_strlen(m); cm_fmt(m + l, (int)sizeof m - l, "%s)", pid ? pid : "none"); return fail(err, errLen, "%s", m); }
          b->bind[k] = pi;
        }
      }
      if (TYPES[t].e1) { const char *s = json_str(j, json_get(j, props, TYPES[t].e1)); int c = s ? choice(TYPES[t].v1, s) : 0; if (c < 0) { char m[120]; cm_fmt(m, sizeof m, "%s: \"%s\" isn't one of the choices for ", id, s); int l = cm_strlen(m); cm_fmt(m + l, (int)sizeof m - l, "%s", TYPES[t].e1); return fail(err, errLen, "%s", m); } b->mode = c; }
      if (TYPES[t].e2) { const char *s = json_str(j, json_get(j, props, TYPES[t].e2)); int c = s ? choice(TYPES[t].v2, s) : 0; if (c < 0) { char m[120]; cm_fmt(m, sizeof m, "%s: \"%s\" isn't one of the choices for ", id, s); int l = cm_strlen(m); cm_fmt(m + l, (int)sizeof m - l, "%s", TYPES[t].e2); return fail(err, errLen, "%s", m); } b->mode2 = c; }
      if (t == B_FILTER || t == B_EQ) b->num[0] = (float)json_num(j, json_get(j, props, "slope"), 12);
      if (t == B_DELAY) b->num[0] = (float)json_num(j, json_get(j, props, "maxTime"), 2000);
      if (t == B_PHASER) b->num[0] = (float)json_num(j, json_get(j, props, "stages"), 4);
      if (t == B_PITCH) b->num[0] = (float)json_num(j, json_get(j, props, "window"), 50);
      if (t == B_PARAM) {
        int v = json_get(j, props, "param"); const char *pid = json_str(j, v);
        if (!pid && v >= 0 && j->nodes[v].type == JN_OBJ) pid = json_str(j, json_get(j, v, "param"));
        b->param = pid ? paramIndex(fx, pid) : -1;
        if (b->param < 0) return fail(err, errLen, "the knob block %s isn't linked to one of the plugin's knobs", id);
      }
      if (t == B_CODE) {
        const char *src = json_str(j, json_get(j, props, "code")); if (!src || !src[0]) src = wholeCode;
        if (!src || !src[0]) return fail(err, errLen, "the code block %s has no code yet", id);
        char e2[200]; int pr = code_compile(&fx->code, src, cm_strlen(src), fx->sr, e2, sizeof e2);
        if (pr < 0) { char m[260]; cm_fmt(m, sizeof m, "%s: ", id); int l = cm_strlen(m); cm_fmt(m + l, (int)sizeof m - l, "%s", e2); return fail(err, errLen, "%s", m); }
        b->prog = pr;
      }
      fx->nBlocks++;
    }
    /* the wires: grouped by the input they go into */
    int from[CM_MAXWIRES], toB[CM_MAXWIRES], toP[CM_MAXWIRES], nw = 0;
    if (wires >= 0 && j->nodes[wires].type != JN_ARR) return fail(err, errLen, "graph.wires must be a list%s", "");
    if (wires >= 0) for (int n = j->nodes[wires].first; n >= 0; n = j->nodes[n].next) {
      if (nw >= CM_MAXWIRES) return fail(err, errLen, "a plugin can have up to 256 wires%s", "");
      const char *f = json_str(j, json_get(j, n, "from")), *t = json_str(j, json_get(j, n, "to"));
      if (!f || !t) return fail(err, errLen, "each wire needs a from and a to%s", "");
      char fb[64], tb[64]; copyStr(fb, sizeof fb, f); copyStr(tb, sizeof tb, t);
      char *fp = 0, *tp = 0; for (char *c = fb; *c; c++) if (*c == '.') { *c = 0; fp = c + 1; break; } for (char *c = tb; *c; c++) if (*c == '.') { *c = 0; tp = c + 1; break; }
      int fbI = blockOf(fx, fb), tbI = blockOf(fx, tb);
      if (fbI < 0) return fail(err, errLen, "a wire starts at a block that isn't there (%s)", fb);
      if (tbI < 0) return fail(err, errLen, "a wire goes to a block that isn't there (%s)", tb);
      if (!TYPES[fx->blocks[fbI].type].hasOut) return fail(err, errLen, "the output block has nothing to send (a wire starts at %s)", fb);
      if (fp && *fp && !cm_streq(fp, "out")) return fail(err, errLen, "blocks send from their out (not %s)", fp);
      int port = portOf(fx->blocks[tbI].type, tp && *tp ? tp : "in");
      if (port < 0) { if (!tp || !*tp) port = TYPES[fx->blocks[tbI].type].nPorts ? 0 : -1; }
      if (port < 0) { char m[120]; cm_fmt(m, sizeof m, "%s has no input called ", tb); int l = cm_strlen(m); cm_fmt(m + l, (int)sizeof m - l, "%s", tp && *tp ? tp : "in"); return fail(err, errLen, "%s", m); }
      if (fbI == tbI) return fail(err, errLen, "%s is wired into itself (use a delay's feedback instead)", fb);
      from[nw] = fbI; toB[nw] = tbI; toP[nw] = port; nw++;
    }
    for (int b = 0; b < fx->nBlocks; b++) for (int p = 0; p < TYPES[fx->blocks[b].type].nPorts; p++) {
      fx->blocks[b].srcStart[p] = fx->nSources;
      for (int w = 0; w < nw; w++) if (toB[w] == b && toP[w] == p) fx->sources[fx->nSources++] = from[w];
      fx->blocks[b].srcCount[p] = fx->nSources - fx->blocks[b].srcStart[p];
    }
    /* the order: a block runs after everything wired into it */
    int indeg[CM_MAXBLOCKS] = { 0 }, done = 0, nOut = 0;
    for (int w = 0; w < nw; w++) indeg[toB[w]]++;
    int queue[CM_MAXBLOCKS], qh = 0, qt = 0;
    for (int b = 0; b < fx->nBlocks; b++) { if (!indeg[b]) queue[qt++] = b; if (fx->blocks[b].type == B_OUTPUT) nOut++; }
    while (qh < qt) { int b = queue[qh++]; fx->order[done++] = b; for (int w = 0; w < nw; w++) if (from[w] == b && --indeg[toB[w]] == 0) queue[qt++] = toB[w]; }
    if (done < fx->nBlocks) { for (int b = 0; b < fx->nBlocks; b++) if (indeg[b]) return fail(err, errLen, "the wiring goes round in a loop at %s (use a delay's feedback instead)", fx->blocks[b].id); }
    if (!nOut) return fail(err, errLen, "add an output block and wire the sound into it%s", "");
  }
  /* memory: each block's buffers, the sums of inputs with several wires, the code's arrays */
  for (int i = 0; i < fx->nBlocks; i++) {
    Block *b = &fx->blocks[i]; planBuffers(fx, b);
    for (int p = 0; p < TYPES[b->type].nPorts; p++) if (b->srcCount[p] > 1) b->sumOff[p] = poolTake(fx, 2 * CM_CHUNK);
  }
  unsigned long codePool = 0; long codeBase[CM_MAXPROGS];
  for (int i = 0; i < fx->code.nProgs; i++) { codeBase[i] = poolTake(fx, fx->code.progs[i].pool); codePool += fx->code.progs[i].pool; }
  for (int i = 0; i < fx->code.nProgs; i++) for (int a = 0; a < fx->code.progs[i].nArr; a++) fx->code.progs[i].arrOff[a] += codeBase[i];
  (void)codePool;
  if (fx->pool > CM_MAXPOOL) return fail(err, errLen, "the plugin needs too much memory (its delays and arrays are too long)%s", "");
  return 0;
}

unsigned long cmfx_pool_floats(CmFx *fx) { return fx->pool ? fx->pool : 1; }

static void resetBlock(CmFx *fx, Block *b) {
  long bl = b->bufLen; float *buf = b->buf;
  if (buf && bl) cm_memset(buf, 0, sizeof(float) * (unsigned long)bl);
  switch (b->type) {
    case B_FILTER: case B_EQ: cm_memset(b->st.f.ic1, 0, sizeof b->st.f.ic1); cm_memset(b->st.f.ic2, 0, sizeof b->st.f.ic2); b->st.f.ok = 0; break;
    case B_DELAY: b->st.d.pos = 0; b->st.d.lp[0] = b->st.d.lp[1] = 0; b->st.d.init = 0; break;
    case B_REVERB: cm_memset(b->st.r.cp, 0, sizeof b->st.r.cp); cm_memset(b->st.r.ap, 0, sizeof b->st.r.ap); cm_memset(b->st.r.cs, 0, sizeof b->st.r.cs); b->st.r.pdPos = 0; break;
    case B_CHORUS: b->st.c.pos = 0; b->st.c.phase = 0; break;
    case B_PHASER: cm_memset(b->st.ph.z, 0, sizeof b->st.ph.z); b->st.ph.fb[0] = b->st.ph.fb[1] = 0; b->st.ph.phase = 0; break;
    case B_DRIVE: cm_memset(&b->st.dr, 0, sizeof b->st.dr); break;
    case B_CRUSH: cm_memset(&b->st.cr, 0, sizeof b->st.cr); break;
    case B_COMP: b->st.cp.env = -120; break;
    case B_LIMIT: b->st.lm.g = 1; break;
    case B_GATE: b->st.g.env = -120; b->st.g.g = 0; b->st.g.hold = 0; break;
    case B_TREMOLO: b->st.t.phase = 0; break;
    case B_PITCH: b->st.p.pos = 0; b->st.p.phase = 0; break;
    case B_LFO: b->st.l.phase = 0; b->st.l.rng = 0x12345u; for (const char *c = b->id; *c; c++) b->st.l.rng = b->st.l.rng * 31u + (unsigned char)*c; b->st.l.cur = 0; b->st.l.target = 0; break;
    case B_ENV: b->st.e.env = 0; break;
    case B_MATH: b->st.m.sm[0] = b->st.m.sm[1] = 0; break;
    case B_CODE: if (b->prog >= 0) code_reset(&fx->code, &fx->code.progs[b->prog]); break;
  }
  cm_memset(b->out, 0, sizeof b->out);
}
void cmfx_attach(CmFx *fx, float *pool) {
  fx->mem = pool; cm_memset(pool, 0, sizeof(float) * cmfx_pool_floats(fx));
  for (int i = 0; i < fx->nBlocks; i++) {
    Block *b = &fx->blocks[i]; b->buf = b->bufLen ? pool + b->bufOff : 0;
    for (int p = 0; p < TYPES[b->type].nPorts; p++) b->sum[p] = b->srcCount[p] > 1 ? pool + b->sumOff[p] : 0;
  }
  for (int i = 0; i < fx->code.nProgs; i++) {
    CProg *p = &fx->code.progs[i];
    float *v = fx->code.vars + p->base; v[CV_SRATE] = fx->sr; v[CV_PI] = (float)CM_PI; v[CV_BLOCK] = CM_CHUNK;
    for (int k = 0; k < fx->nParams; k++) v[CV_PARAMS + k] = fx->params[k].cur;
    p->arr[0] = 0; for (int a = 0; a < p->nArr; a++) p->arr[a] = pool + p->arrOff[a];
  }
  fx->attached = 1;
  for (int i = 0; i < fx->nBlocks; i++) resetBlock(fx, &fx->blocks[i]);
}
static void snapParams(CmFx *fx) { for (int p = 0; p < fx->nParams; p++) { Param *q = &fx->params[p]; q->cur = q->target; for (int i = 0; i < CM_CHUNK; i++) q->buf[i] = q->cur; } }
void cmfx_reset(CmFx *fx) { if (!fx->attached) return; snapParams(fx); for (int i = 0; i < fx->nBlocks; i++) resetBlock(fx, &fx->blocks[i]); fx->status = 0; }

/* ---------------------------------------------------------------- the blocks */
static void filterCoefs(StFilter *f, int ch, int mode, float fc, float q, float gdb, float sr) {
  fc = clampf(fc, 10, 0.49f * sr); q = clampf(q, 0.1f, 30); gdb = clampf(gdb, -24, 24);
  double g = cm_tan(CM_PI * fc / sr), k = 1.0 / q, A = cm_pow(10, gdb / 40.0), m0 = 0, m1 = 0, m2 = 0;
  switch (mode) {
    case 0: m2 = 1; break;                                   /* lowpass */
    case 1: m0 = 1; m1 = -k; m2 = -1; break;                 /* highpass */
    case 2: m1 = k; break;                                   /* bandpass (peak 1) */
    case 3: m0 = 1; m1 = -k; break;                          /* notch */
    case 4: k = 1.0 / (q * A); m0 = 1; m1 = k * (A * A - 1); break;   /* peak */
    case 5: g /= cm_sqrt(A); m0 = 1; m1 = k * (A - 1); m2 = A * A - 1; break;   /* low shelf */
    case 6: g *= cm_sqrt(A); m0 = A * A; m1 = k * (1 - A) * A; m2 = 1 - A * A; break;   /* high shelf */
    default: m0 = 1; m1 = -2 * k; break;                     /* allpass */
  }
  double a1 = 1.0 / (1.0 + g * (g + k));
  f->a1[ch] = a1; f->a2[ch] = g * a1; f->a3[ch] = g * g * a1; f->m0[ch] = m0; f->m1[ch] = m1; f->m2[ch] = m2;
}
static const int FMODE[2][8] = { { 0, 1, 2, 3, 4, 5, 6, 7 }, { 4, 5, 6, 0, 1, 2, 3, 7 } };   /* filter / eq choice -> the maths' mode */
static void runFilter(CmFx *fx, Block *b, int n) {
  StFilter *f = &b->st.f; int mode = FMODE[b->type == B_EQ][b->mode]; int stages = (b->num[0] >= 24 && (mode == 0 || mode == 1)) ? 2 : 1;
  int moving = !sconst(&b->in[1]) || !sconst(&b->in[2]) || !sconst(&b->in[3]);
  for (int ch = 0; ch < 2; ch++) {
    if (!moving) {
      float fc = b->in[1].k, q = b->in[2].k, g = b->in[3].k;
      if (!f->ok || fc != f->lf[ch] || q != f->lq[ch] || g != f->lg[ch]) { filterCoefs(f, ch, mode, fc, q, g, fx->sr); f->lf[ch] = fc; f->lq[ch] = q; f->lg[ch] = g; }
    }
    for (int i = 0; i < n; i++) {
      if (moving && (i & 7) == 0) filterCoefs(f, ch, mode, sg(&b->in[1], ch, i), sg(&b->in[2], ch, i), sg(&b->in[3], ch, i), fx->sr);
      float x = sg(&b->in[0], ch, i);
      for (int s = 0; s < stages; s++) {
        double v0 = x, v3 = v0 - f->ic2[s][ch], v1 = f->a1[ch] * f->ic1[s][ch] + f->a2[ch] * v3, v2 = f->ic2[s][ch] + f->a2[ch] * f->ic1[s][ch] + f->a3[ch] * v3;
        f->ic1[s][ch] = (float)(2 * v1 - f->ic1[s][ch]); f->ic2[s][ch] = (float)(2 * v2 - f->ic2[s][ch]); UND(f->ic1[s][ch]); UND(f->ic2[s][ch]);
        x = (float)(f->m0[ch] * v0 + f->m1[ch] * v1 + f->m2[ch] * v2);
      }
      b->out[ch][i] = x;
    }
  }
  if (!moving) f->ok = 1; else f->ok = 0;
}
static inline float rd(const float *buf, long len, int pos, float d) {   /* d samples behind the newest (pos - 1) */
  if (d < 0) d = 0; if (d > (float)(len - 3)) d = (float)(len - 3);
  int di = (int)d; float fr = d - (float)di; long i0 = pos - 1 - di; while (i0 < 0) i0 += len; long i1 = i0 - 1; if (i1 < 0) i1 += len;
  return buf[i0] + (buf[i1] - buf[i0]) * fr;
}
static void runDelay(CmFx *fx, Block *b, int n) {
  StDelay *d = &b->st.d; float *L = b->buf, *R = b->buf + d->len; float sr = fx->sr;
  float tone = clampf(b->in[4].p[0] ? b->in[4].p[0][0] : b->in[4].k, 200, 20000); float ta = (float)(1 - cm_exp(-2 * CM_PI * tone / sr));
  if (!d->init) { float t = clampf(sg(&b->in[1], 0, 0), 1, 10000) * sr * 0.001f; d->ts[0] = d->ts[1] = t; d->init = 1; }
  for (int i = 0; i < n; i++) {
    float rdv[2];
    for (int ch = 0; ch < 2; ch++) { float t = clampf(sg(&b->in[1], ch, i), 1, 10000) * sr * 0.001f; d->ts[ch] += (t - d->ts[ch]) * 0.002f; rdv[ch] = rd(ch ? R : L, d->len, d->pos, d->ts[ch]); d->lp[ch] += (rdv[ch] - d->lp[ch]) * ta; UND(d->lp[ch]); }
    float inL = sg(&b->in[0], 0, i), inR = sg(&b->in[0], 1, i);
    float fb0 = clampf(sg(&b->in[2], 0, i), 0, 0.98f), fb1 = clampf(sg(&b->in[2], 1, i), 0, 0.98f);
    if (b->mode == 1) { L[d->pos] = (inL + inR) * 0.5f + d->lp[1] * fb0; R[d->pos] = d->lp[0] * fb1; }
    else { L[d->pos] = inL + d->lp[0] * fb0; R[d->pos] = inR + d->lp[1] * fb1; }
    if (++d->pos >= d->len) d->pos = 0;
    float m0 = clampf(sg(&b->in[3], 0, i), 0, 1), m1 = clampf(sg(&b->in[3], 1, i), 0, 1);
    b->out[0][i] = inL * (1 - m0) + rdv[0] * m0; b->out[1][i] = inR * (1 - m1) + rdv[1] * m1;
  }
}
static void runReverb(CmFx *fx, Block *b, int n) {
  StReverb *r = &b->st.r; float *buf = b->buf; float *pd = buf + r->pdOff;
  for (int i = 0; i < n; i++) {
    float size = clampf(sg(&b->in[1], 0, i), 0, 1), damp = clampf(sg(&b->in[2], 0, i), 0, 1) * 0.4f, fbk = 0.7f + size * 0.28f;
    float pre = clampf(sg(&b->in[4], 0, i), 0, 250) * fx->sr * 0.001f, width = clampf(sg(&b->in[5], 0, i), 0, 1);
    float inL = sg(&b->in[0], 0, i), inR = sg(&b->in[0], 1, i);
    pd[r->pdPos] = (inL + inR) * 0.015f; if (++r->pdPos >= r->pdLen) r->pdPos = 0;
    float x = pre < 1 ? pd[(r->pdPos + r->pdLen - 1) % r->pdLen] : rd(pd, r->pdLen, r->pdPos, pre);
    float acc[2];
    for (int ch = 0; ch < 2; ch++) {
      float a = 0;
      for (int j = 0; j < 8; j++) {
        float *c = buf + r->co[ch][j]; int p = r->cp[ch][j]; float y = c[p];
        r->cs[ch][j] = y * (1 - damp) + r->cs[ch][j] * damp; UND(r->cs[ch][j]);
        c[p] = x + r->cs[ch][j] * fbk; UND(c[p]); if (++p >= r->cl[ch][j]) p = 0; r->cp[ch][j] = p; a += y;
      }
      for (int j = 0; j < 4; j++) {
        float *c = buf + r->ao[ch][j]; int p = r->ap[ch][j]; float bo = c[p], y = -a + bo;
        c[p] = a + bo * 0.5f; UND(c[p]); if (++p >= r->al[ch][j]) p = 0; r->ap[ch][j] = p; a = y;
      }
      acc[ch] = a;
    }
    float w1 = width * 0.5f + 0.5f, w2 = (1 - width) * 0.5f;   /* (Freeverb's wet at 1/3 of its scale: about as loud as the dry sound) */
    float wl = acc[0] * w1 + acc[1] * w2, wr = acc[1] * w1 + acc[0] * w2;
    float m0 = clampf(sg(&b->in[3], 0, i), 0, 1), m1 = clampf(sg(&b->in[3], 1, i), 0, 1);
    b->out[0][i] = inL * (1 - m0) + wl * m0; b->out[1][i] = inR * (1 - m1) + wr * m1;
  }
}
static void runChorus(CmFx *fx, Block *b, int n) {
  StChorus *c = &b->st.c; float *L = b->buf, *R = b->buf + c->len; float sr = fx->sr;
  float base = b->mode ? 0.5f : 7.0f, range = b->mode ? 4.0f : 12.0f;
  for (int i = 0; i < n; i++) {
    float rate = clampf(sg(&b->in[1], 0, i), 0.01f, 10); c->phase += rate / sr; if (c->phase >= 1) c->phase -= 1;
    float rv[2];
    for (int ch = 0; ch < 2; ch++) {
      float lfo = (float)cm_sin(2 * CM_PI * (c->phase + ch * 0.25)), depth = clampf(sg(&b->in[2], ch, i), 0, 1);
      float dms = base + depth * range * (0.5f + 0.5f * lfo); rv[ch] = rd(ch ? R : L, c->len, c->pos, dms * sr * 0.001f);
    }
    for (int ch = 0; ch < 2; ch++) {
      float x = sg(&b->in[0], ch, i), fbk = clampf(sg(&b->in[3], ch, i), -0.95f, 0.95f), m = clampf(sg(&b->in[4], ch, i), 0, 1);
      float w = x + rv[ch] * fbk; UND(w); (ch ? R : L)[c->pos] = w;
      b->out[ch][i] = x * (1 - m) + rv[ch] * m;
    }
    if (++c->pos >= c->len) c->pos = 0;
  }
}
static void runPhaser(CmFx *fx, Block *b, int n) {
  StPhaser *p = &b->st.ph; int stages = (int)b->num[0]; if (stages < 2) stages = 2; if (stages > 12) stages = 12; float sr = fx->sr;
  for (int i = 0; i < n; i++) {
    float rate = clampf(sg(&b->in[1], 0, i), 0.01f, 10); p->phase += rate / sr; if (p->phase >= 1) p->phase -= 1;
    for (int ch = 0; ch < 2; ch++) {
      if ((i & 7) == 0) {
        float depth = clampf(sg(&b->in[2], ch, i), 0, 1); double l01 = 0.5 + 0.5 * cm_sin(2 * CM_PI * (p->phase + ch * 0.25));
        double f = 200.0 * cm_pow(20.0, depth * l01); if (f > 0.45 * sr) f = 0.45 * sr; double t = cm_tan(CM_PI * f / sr); p->a[ch] = (t - 1) / (t + 1);
      }
      float x0 = sg(&b->in[0], ch, i), fbk = clampf(sg(&b->in[3], ch, i), -0.95f, 0.95f), m = clampf(sg(&b->in[4], ch, i), 0, 1);
      float x = x0 + p->fb[ch] * fbk; float a = (float)p->a[ch];
      for (int s = 0; s < stages; s++) { float y = a * x + p->z[ch][s]; p->z[ch][s] = x - a * y; UND(p->z[ch][s]); x = y; }
      p->fb[ch] = x; UND(p->fb[ch]);
      b->out[ch][i] = x0 * (1 - m) + x * m;
    }
  }
}
static void runDrive(CmFx *fx, Block *b, int n) {
  StDrive *d = &b->st.dr; float sr = fx->sr;
  for (int ch = 0; ch < 2; ch++) { float ta = (float)(1 - cm_exp(-2 * CM_PI * clampf(sg(&b->in[2], ch, 0), 200, 20000) / sr)); for (int i = 0; i < n; i++) {
    float x0 = sg(&b->in[0], ch, i), pre = cm_db2lin(clampf(sg(&b->in[1], ch, i), 0, 48)), x = x0 * pre, y;
    switch (b->mode) {
      case 1: y = clampf(x, -1, 1); break;
      case 2: y = (float)(cm_tanh(x + 0.25) - 0.24491866240370913); break;
      case 3: { float ax = x < 0 ? -x : x; y = (float)(1 - cm_exp(-ax * 1.5)); if (x < 0) y = -y * 0.8f; break; }
      case 4: y = (float)cm_sin(x); break;
      default: y = (float)cm_tanh(x);
    }
    if (b->mode == 2 || b->mode == 3) { float o = y - d->x1[ch] + 0.995f * d->y1[ch]; d->x1[ch] = y; d->y1[ch] = o; UND(d->y1[ch]); y = o; }
    d->lp[ch] += (y - d->lp[ch]) * ta; UND(d->lp[ch]);
    float out = d->lp[ch] * cm_db2lin(clampf(sg(&b->in[3], ch, i), -48, 12)), m = clampf(sg(&b->in[4], ch, i), 0, 1);
    b->out[ch][i] = x0 * (1 - m) + out * m;
  } }
}
static void runCrush(CmFx *fx, Block *b, int n) {
  StCrush *c = &b->st.cr;
  for (int i = 0; i < n; i++) {
    float bits = clampf(sg(&b->in[1], 0, i), 1, 24), rate = clampf(sg(&b->in[2], 0, i), 200, 48000);
    float step = (float)(2.0 / cm_pow(2, bits));
    c->phase += rate / fx->sr; int take = c->phase >= 1; if (take) c->phase -= cm_floor(c->phase);
    for (int ch = 0; ch < 2; ch++) {
      float x = sg(&b->in[0], ch, i);
      if (take) c->hold[ch] = (float)cm_floor(x / step + 0.5f) * step;
      float m = clampf(sg(&b->in[3], ch, i), 0, 1); b->out[ch][i] = x * (1 - m) + c->hold[ch] * m;
    }
  }
}
static void runComp(CmFx *fx, Block *b, int n) {
  StComp *c = &b->st.cp; int keyed = b->srcCount[1] > 0; float sr = fx->sr;
  float att = clampf(sg(&b->in[4], 0, 0), 0.1f, 200), rel = clampf(sg(&b->in[5], 0, 0), 5, 2000);
  float aa = (float)cm_exp(-1.0 / (att * sr * 0.001)), ar = (float)cm_exp(-1.0 / (rel * sr * 0.001));
  for (int i = 0; i < n; i++) {
    float l = sg(&b->in[0], 0, i), r = sg(&b->in[0], 1, i);
    float dl = keyed ? sg(&b->in[1], 0, i) : l, dr = keyed ? sg(&b->in[1], 1, i) : r;
    float det = dl < 0 ? -dl : dl, d2 = dr < 0 ? -dr : dr; if (d2 > det) det = d2;
    float db = cm_lin2db(det);
    c->env = db > c->env ? aa * c->env + (1 - aa) * db : ar * c->env + (1 - ar) * db; if (c->env < -120) c->env = -120;
    float thr = sg(&b->in[2], 0, i), ratio = clampf(sg(&b->in[3], 0, i), 1, 30), knee = clampf(sg(&b->in[6], 0, i), 0, 24), over = c->env - thr, gr;
    float slope = 1.0f / ratio - 1.0f;
    if (knee > 0 && 2 * over > -knee && 2 * over < knee) gr = slope * (over + knee * 0.5f) * (over + knee * 0.5f) / (2 * knee);
    else gr = over > 0 ? slope * over : 0;
    float g = cm_db2lin(gr + sg(&b->in[7], 0, i)), m = clampf(sg(&b->in[8], 0, i), 0, 1);
    b->out[0][i] = l * (1 - m) + l * g * m; b->out[1][i] = r * (1 - m) + r * g * m;
  }
}
static void runLimit(CmFx *fx, Block *b, int n) {
  StLimit *s = &b->st.lm; float rel = clampf(sg(&b->in[2], 0, 0), 5, 1000), rc = (float)(1 - cm_exp(-1.0 / (rel * fx->sr * 0.001)));
  for (int i = 0; i < n; i++) {
    float l = sg(&b->in[0], 0, i), r = sg(&b->in[0], 1, i), c = cm_db2lin(clampf(sg(&b->in[1], 0, i), -24, 0));
    float pk = l < 0 ? -l : l, p2 = r < 0 ? -r : r; if (p2 > pk) pk = p2;
    float target = pk > c ? c / pk : 1;
    if (target < s->g) s->g = target; else s->g += (target - s->g) * rc;
    b->out[0][i] = clampf(l * s->g, -c, c); b->out[1][i] = clampf(r * s->g, -c, c);
  }
}
static void runGate(CmFx *fx, Block *b, int n) {
  StGate *g = &b->st.g; int keyed = b->srcCount[1] > 0; float sr = fx->sr;
  float att = clampf(sg(&b->in[4], 0, 0), 0.1f, 50), rel = clampf(sg(&b->in[6], 0, 0), 5, 2000);
  float ca = (float)(1 - cm_exp(-1.0 / (att * sr * 0.001))), cr = (float)(1 - cm_exp(-1.0 / (rel * sr * 0.001))), ce = (float)(1 - cm_exp(-1.0 / (0.005 * sr)));
  for (int i = 0; i < n; i++) {
    float l = sg(&b->in[0], 0, i), r = sg(&b->in[0], 1, i);
    float dl = keyed ? sg(&b->in[1], 0, i) : l, dr = keyed ? sg(&b->in[1], 1, i) : r;
    float det = dl < 0 ? -dl : dl, d2 = dr < 0 ? -dr : dr; if (d2 > det) det = d2;
    float db = cm_lin2db(det); g->env += (db - g->env) * (db > g->env ? 1.0f : ce);
    float thr = sg(&b->in[2], 0, i), range = cm_db2lin(clampf(sg(&b->in[3], 0, i), -90, 0)); int holdS = (int)(clampf(sg(&b->in[5], 0, i), 0, 500) * sr * 0.001f);
    int open = g->env > thr; if (open) g->hold = holdS; else if (g->hold > 0) { g->hold--; open = 1; }
    float target = open ? 1.0f : range; g->g += (target - g->g) * (target > g->g ? ca : cr);
    b->out[0][i] = l * g->g; b->out[1][i] = r * g->g;
  }
}
static float wave(int shape, double ph, StLfo *l) {
  ph -= cm_floor(ph);
  switch (shape) {
    case 1: return (float)(1 - 4 * cm_fabs(ph - 0.5));
    case 2: return (float)(2 * ph - 1);
    case 3: return (float)(1 - 2 * ph);
    case 4: return ph < 0.5 ? 1.0f : -1.0f;
    case 5: return l ? l->cur + (l->target - l->cur) * (float)ph : 0;
    default: return (float)cm_sin(2 * CM_PI * ph);
  }
}
static void runTremolo(CmFx *fx, Block *b, int n) {
  StTrem *t = &b->st.t;
  for (int i = 0; i < n; i++) {
    float rate = clampf(sg(&b->in[1], 0, i), 0.05f, 20); t->phase += rate / fx->sr; if (t->phase >= 1) t->phase -= 1;
    for (int ch = 0; ch < 2; ch++) {
      double off = b->mode == 1 ? ch * 0.5 : ch * clampf(sg(&b->in[3], 0, i), 0, 180) / 360.0;
      float w = wave(b->mode2 == 5 ? 0 : b->mode2, t->phase + off, 0), depth = clampf(sg(&b->in[2], ch, i), 0, 1);
      b->out[ch][i] = sg(&b->in[0], ch, i) * (1 - depth * 0.5f * (1 - w));
    }
  }
}
static void runPitch(CmFx *fx, Block *b, int n) {
  StPitch *p = &b->st.p; float *L = b->buf, *R = b->buf + p->len; float W = b->num[0] * fx->sr * 0.001f;
  for (int i = 0; i < n; i++) {
    float semi = clampf(sg(&b->in[1], 0, i), -24, 24) + clampf(sg(&b->in[2], 0, i), -100, 100) * 0.01f;
    double ratio = cm_exp(semi * 0.05776226504666210911);   /* 2^(semi/12) */
    L[p->pos] = sg(&b->in[0], 0, i); R[p->pos] = sg(&b->in[0], 1, i); if (++p->pos >= p->len) p->pos = 0;
    p->phase += (1 - ratio) / W; p->phase -= cm_floor(p->phase);
    double ph2 = p->phase + 0.5; ph2 -= cm_floor(ph2);
    float g1 = (float)(0.5 - 0.5 * cm_cos(2 * CM_PI * p->phase)), g2 = 1 - g1;
    for (int ch = 0; ch < 2; ch++) {
      float *buf = ch ? R : L;
      float y = g1 * rd(buf, p->len, p->pos, (float)(p->phase * W)) + g2 * rd(buf, p->len, p->pos, (float)(ph2 * W));
      float m = clampf(sg(&b->in[3], ch, i), 0, 1); b->out[ch][i] = sg(&b->in[0], ch, i) * (1 - m) + y * m;
    }
  }
}
static void runLfo(CmFx *fx, Block *b, int n) {
  StLfo *l = &b->st.l;
  for (int i = 0; i < n; i++) {
    float rate = clampf(sg(&b->in[0], 0, i), 0.01f, 40); l->phase += rate / fx->sr;
    if (l->phase >= 1) { l->phase -= cm_floor(l->phase); l->cur = l->target; unsigned r = l->rng; r ^= r << 13; r ^= r >> 17; r ^= r << 5; l->rng = r; l->target = (float)(r >> 8) * (2.0f / 16777216.0f) - 1; }
    float from = sg(&b->in[1], 0, i), to = sg(&b->in[2], 0, i); double off = sg(&b->in[3], 0, i) / 360.0;
    for (int ch = 0; ch < 2; ch++) { float w = wave(b->mode, l->phase + off + ch * sg(&b->in[4], 0, i) / 360.0, l); b->out[ch][i] = from + (to - from) * (0.5f + 0.5f * w); }
  }
}
static void runEnv(CmFx *fx, Block *b, int n) {
  StEnv *e = &b->st.e; float sr = fx->sr;
  float att = clampf(sg(&b->in[1], 0, 0), 0.1f, 500), rel = clampf(sg(&b->in[2], 0, 0), 1, 5000);
  float aa = (float)cm_exp(-1.0 / (att * sr * 0.001)), ar = (float)cm_exp(-1.0 / (rel * sr * 0.001)), sens = cm_db2lin(clampf(sg(&b->in[3], 0, 0), -24, 24));
  for (int i = 0; i < n; i++) {
    float l = sg(&b->in[0], 0, i), r = sg(&b->in[0], 1, i), lv = l < 0 ? -l : l, r2 = r < 0 ? -r : r; if (r2 > lv) lv = r2; lv *= sens;
    e->env = lv > e->env ? aa * e->env + (1 - aa) * lv : ar * e->env + (1 - ar) * lv; UND(e->env);
    float from = sg(&b->in[4], 0, i), to = sg(&b->in[5], 0, i), v = from + (to - from) * clampf(e->env, 0, 1);
    b->out[0][i] = b->out[1][i] = v;
  }
}
static void runMath(CmFx *fx, Block *b, int n) {
  for (int ch = 0; ch < 2; ch++) for (int i = 0; i < n; i++) {
    float a = sg(&b->in[0], ch, i), c = sg(&b->in[1], ch, i), y;
    switch (b->mode) {
      case 0: y = a + c; break; case 1: y = a - c; break; case 2: y = a * c; break; case 3: y = c != 0 ? a / c : 0; break;
      case 4: y = a < c ? a : c; break; case 5: y = a > c ? a : c; break; case 6: y = a < 0 ? -a : a; break; case 7: y = -a; break;
      case 8: y = clampf(a, sg(&b->in[2], ch, i), sg(&b->in[3], ch, i)); break;
      case 9: { float il = sg(&b->in[4], ch, i), ih = sg(&b->in[5], ch, i), ol = sg(&b->in[6], ch, i), oh = sg(&b->in[7], ch, i); y = ih != il ? ol + (a - il) * (oh - ol) / (ih - il) : ol; break; }
      case 10: y = cm_db2lin(clampf(a, -200, 60)); break; case 11: y = cm_lin2db(a < 0 ? -a : a); break;
      case 12: y = (float)cm_sin(a); break; case 13: y = (float)cm_tanh(a); break;
      case 15: { float ms = c > 0.1f ? c : 0.1f; float k = (float)(1 - cm_exp(-1.0 / (ms * fx->sr * 0.001))); b->st.m.sm[ch] += (a - b->st.m.sm[ch]) * k; UND(b->st.m.sm[ch]); y = b->st.m.sm[ch]; break; }
      default: y = a;
    }
    b->out[ch][i] = y;
  }
}
static void runStereo(Block *b, int n) {
  for (int i = 0; i < n; i++) {
    float l = sg(&b->in[0], 0, i), r = sg(&b->in[0], 1, i);
    if (b->mode == 1) { float m = (l + r) * 0.5f; l = r = m; } else if (b->mode == 2) { float t = l; l = r; r = t; }
    float w = clampf(sg(&b->in[1], 0, i), 0, 2), m = (l + r) * 0.5f, s = (l - r) * 0.5f * w; l = m + s; r = m - s;
    float pan = clampf(sg(&b->in[2], 0, i), -1, 1); l *= pan > 0 ? 1 - pan : 1; r *= pan < 0 ? 1 + pan : 1;
    b->out[0][i] = l; b->out[1][i] = r;
  }
}
static void runCode(CmFx *fx, Block *b, int n) {
  CProg *p = &fx->code.progs[b->prog]; float *v = fx->code.vars + p->base;
  if (p->disabled) { for (int ch = 0; ch < 2; ch++) for (int i = 0; i < n; i++) b->out[ch][i] = sg(&b->in[0], ch, i); return; }
  for (int k = 0; k < fx->nParams; k++) v[CV_PARAMS + k] = fx->params[k].buf[0];
  v[CV_BLOCK] = (float)n;
  if (p->block >= 0) { for (int k = 0; k < 4; k++) v[CV_C1 + k] = sg(&b->in[1 + k], 0, 0); if (code_run(&fx->code, p, p->block)) p->overRuns++; }
  for (int i = 0; i < n; i++) {
    float l = sg(&b->in[0], 0, i), r = sg(&b->in[0], 1, i);
    v[CV_INL] = l; v[CV_INR] = r; v[CV_OUTL] = l; v[CV_OUTR] = r;
    for (int k = 0; k < 4; k++) v[CV_C1 + k] = sg(&b->in[1 + k], 0, i);
    if (fx->nParams && (i & 15) == 0) for (int k = 0; k < fx->nParams; k++) v[CV_PARAMS + k] = fx->params[k].buf[i];
    p->runs++;
    if (p->sample >= 0 && code_run(&fx->code, p, p->sample)) p->overRuns++;
    float ol = v[CV_OUTL], orr = v[CV_OUTR];
    if (!cm_isfinite(ol) || !cm_isfinite(orr)) { ol = orr = 0; code_reset(&fx->code, p); p->badNumber++; fx->status = "the code made an invalid number (divided by zero?), so it was started again"; }
    b->out[0][i] = ol; b->out[1][i] = orr;
  }
  if (p->runs >= 48000) {
    if (p->overRuns * 2 > p->runs) { p->disabled = 1; fx->status = "the code does too much work for each sample, so it was switched off (the sound passes through)"; }
    p->runs = p->overRuns = 0;
  }
}

static void resolve(CmFx *fx, Block *b) {
  for (int p = 0; p < TYPES[b->type].nPorts; p++) {
    Sig *s = &b->in[p]; int cnt = b->srcCount[p];
    if (cnt == 0) { s->p[0] = s->p[1] = 0; if (b->bind[p] >= 0) { s->p[0] = s->p[1] = fx->params[b->bind[p]].buf; } else s->k = b->konst[p]; }
    else if (cnt == 1) { Block *src = &fx->blocks[fx->sources[b->srcStart[p]]]; s->p[0] = src->out[0]; s->p[1] = src->out[1]; }
    else {
      float *sum = b->sum[p]; cm_memset(sum, 0, sizeof(float) * 2 * CM_CHUNK);
      for (int k = 0; k < cnt; k++) { Block *src = &fx->blocks[fx->sources[b->srcStart[p] + k]]; for (int i = 0; i < CM_CHUNK; i++) { sum[i] += src->out[0][i]; sum[CM_CHUNK + i] += src->out[1][i]; } }
      s->p[0] = sum; s->p[1] = sum + CM_CHUNK;
    }
  }
}

static void chunk(CmFx *fx, const float *inL, const float *inR, float *outL, float *outR, int n) {
  for (int i = 0; i < n; i++) { float l = inL ? inL[i] : 0; fx->inBuf[0][i] = l; fx->inBuf[1][i] = inR ? inR[i] : l; }
  float k = (float)(1 - cm_exp(-1.0 / (0.02 * fx->sr)));   /* knobs glide over ~20 ms */
  for (int p = 0; p < fx->nParams; p++) { Param *q = &fx->params[p]; float t = q->target; for (int i = 0; i < n; i++) { q->cur += (t - q->cur) * k; q->buf[i] = q->cur; } if (q->cur - t < 1e-6f && t - q->cur < 1e-6f) q->cur = t; }
  for (int oi = 0; oi < fx->nBlocks; oi++) {
    Block *b = &fx->blocks[fx->order[oi]]; resolve(fx, b);
    switch (b->type) {
      case B_INPUT: for (int i = 0; i < n; i++) { b->out[0][i] = fx->inBuf[0][i]; b->out[1][i] = fx->inBuf[1][i]; } break;
      case B_OUTPUT: break;
      case B_GAIN:
        if (sconst(&b->in[1])) { float g = cm_db2lin(clampf(b->in[1].k, -60, 24)); for (int ch = 0; ch < 2; ch++) for (int i = 0; i < n; i++) b->out[ch][i] = sg(&b->in[0], ch, i) * g; }
        else for (int ch = 0; ch < 2; ch++) for (int i = 0; i < n; i++) b->out[ch][i] = sg(&b->in[0], ch, i) * cm_db2lin(clampf(sg(&b->in[1], ch, i), -60, 24));
        break;
      case B_MIX: for (int ch = 0; ch < 2; ch++) for (int i = 0; i < n; i++) { float m = clampf(sg(&b->in[2], ch, i), 0, 1), d = sg(&b->in[0], ch, i), w = sg(&b->in[1], ch, i);
          if (b->mode == 1) b->out[ch][i] = d * (float)cm_cos(m * CM_PI * 0.5) + w * (float)cm_sin(m * CM_PI * 0.5); else b->out[ch][i] = d * (1 - m) + w * m; } break;
      case B_FILTER: case B_EQ: runFilter(fx, b, n); break;
      case B_DELAY: runDelay(fx, b, n); break;
      case B_REVERB: runReverb(fx, b, n); break;
      case B_CHORUS: runChorus(fx, b, n); break;
      case B_PHASER: runPhaser(fx, b, n); break;
      case B_DRIVE: runDrive(fx, b, n); break;
      case B_CRUSH: runCrush(fx, b, n); break;
      case B_COMP: runComp(fx, b, n); break;
      case B_LIMIT: runLimit(fx, b, n); break;
      case B_GATE: runGate(fx, b, n); break;
      case B_TREMOLO: runTremolo(fx, b, n); break;
      case B_PITCH: runPitch(fx, b, n); break;
      case B_LFO: runLfo(fx, b, n); break;
      case B_ENV: runEnv(fx, b, n); break;
      case B_MATH: runMath(fx, b, n); break;
      case B_PARAM: for (int i = 0; i < n; i++) b->out[0][i] = b->out[1][i] = fx->params[b->param].buf[i]; break;
      case B_CODE: runCode(fx, b, n); break;
      case B_STEREO: runStereo(b, n); break;
    }
  }
  for (int i = 0; i < n; i++) { outL[i] = 0; if (outR) outR[i] = 0; }
  for (int bi = 0; bi < fx->nBlocks; bi++) {
    Block *b = &fx->blocks[bi]; if (b->type != B_OUTPUT) continue;
    for (int i = 0; i < n; i++) { outL[i] += sg(&b->in[0], 0, i); if (outR) outR[i] += sg(&b->in[0], 1, i); }
  }
  for (int i = 0; i < n; i++) {
    if (!cm_isfinite(outL[i])) outL[i] = 0; outL[i] = clampf(outL[i], -16, 16);
    if (outR) { if (!cm_isfinite(outR[i])) outR[i] = 0; outR[i] = clampf(outR[i], -16, 16); }
  }
}
void cmfx_process(CmFx *fx, const float *inL, const float *inR, float *outL, float *outR, int n) {
  if (!fx->attached) { for (int i = 0; i < n; i++) { outL[i] = inL ? inL[i] : 0; if (outR) outR[i] = inR ? inR[i] : (inL ? inL[i] : 0); } return; }
  int off = 0;
  while (off < n) {
    int m = n - off; if (m > CM_CHUNK) m = CM_CHUNK;
    chunk(fx, inL ? inL + off : 0, inR ? inR + off : 0, outL + off, outR ? outR + off : 0, m);
    off += m;
  }
}

/* ---------------------------------------------------------------- knobs and names */
const char *cmfx_name(CmFx *fx) { return fx->name; }
const char *cmfx_author(CmFx *fx) { return fx->author; }
const char *cmfx_status(CmFx *fx) { return fx->status; }
int cmfx_param_count(CmFx *fx) { return fx->nParams; }
static Param *P(CmFx *fx, int i) { static Param none; return i >= 0 && i < fx->nParams ? &fx->params[i] : &none; }
const char *cmfx_param_id(CmFx *fx, int i) { return P(fx, i)->id; }
const char *cmfx_param_name(CmFx *fx, int i) { return P(fx, i)->name; }
const char *cmfx_param_unit(CmFx *fx, int i) { return P(fx, i)->unit; }
float cmfx_param_min(CmFx *fx, int i) { return P(fx, i)->min; }
float cmfx_param_max(CmFx *fx, int i) { return P(fx, i)->max; }
float cmfx_param_default(CmFx *fx, int i) { return P(fx, i)->def; }
int cmfx_param_log(CmFx *fx, int i) { return P(fx, i)->log; }
float cmfx_param_get(CmFx *fx, int i) { return P(fx, i)->target; }
void cmfx_set_param(CmFx *fx, int i, float v) { if (i < 0 || i >= fx->nParams || !cm_isfinite(v)) return; Param *p = &fx->params[i]; p->target = clampf(v, p->min, p->max); }
float cmfx_param_to_norm(CmFx *fx, int i, float v) {
  Param *p = P(fx, i); if (!(p->max > p->min)) return 0; v = clampf(v, p->min, p->max);
  return p->log ? (float)(cm_log(v / p->min) / cm_log(p->max / p->min)) : (v - p->min) / (p->max - p->min);
}
float cmfx_param_from_norm(CmFx *fx, int i, float n) {
  Param *p = P(fx, i); n = clampf(n, 0, 1);
  return p->log ? (float)(p->min * cm_exp(n * cm_log(p->max / p->min))) : p->min + n * (p->max - p->min);
}
int cmfx_param_index(CmFx *fx, const char *id) { return paramIndex(fx, id); }

/* ---------------------------------------------------------------- the block types, for the builder (so its palette
 * always matches what this core plays): [{type, ports:[{name, audio, default, min, max}], out, choices:{name:[...]}}] */
static int putS(char *o, int at, int cap, const char *s) { while (*s && at < cap - 1) o[at++] = *s++; o[at] = 0; return at; }
static int putN(char *o, int at, int cap, double v) {
  char b[40]; int n = 0;
  if (v >= 1e8 || v <= -1e8) { at = putS(o, at, cap, v < 0 ? "-1e9" : "1e9"); return at; }
  if (v < 0) { b[n++] = '-'; v = -v; }
  long long ip = (long long)v; double fr = v - (double)ip; char dg[24]; int k = 0;
  do { dg[k++] = (char)('0' + ip % 10); ip /= 10; } while (ip); while (k) b[n++] = dg[--k];
  long long f = (long long)(fr * 1000000.0 + 0.5); if (f >= 1000000) f = 999999;
  if (f) { b[n++] = '.'; char fd[7]; for (int i = 5; i >= 0; i--) { fd[i] = (char)('0' + f % 10); f /= 10; } int e = 6; while (e > 0 && fd[e - 1] == '0') e--; for (int i = 0; i < e; i++) b[n++] = fd[i]; }
  b[n] = 0; return putS(o, at, cap, b);
}
const char *cmfx_types_json(void) {
  static char o[12000]; int at = 0, cap = (int)sizeof o;
  if (o[0]) return o;
  at = putS(o, at, cap, "[");
  for (int t = 0; t < B_NTYPES; t++) {
    const TypeSpec *ts = &TYPES[t];
    at = putS(o, at, cap, t ? ",{\"type\":\"" : "{\"type\":\""); at = putS(o, at, cap, ts->type); at = putS(o, at, cap, "\",\"out\":"); at = putS(o, at, cap, ts->hasOut ? "true" : "false");
    at = putS(o, at, cap, ",\"ports\":[");
    for (int p = 0; p < ts->nPorts; p++) {
      const PortSpec *ps = &ts->ports[p];
      at = putS(o, at, cap, p ? ",{\"name\":\"" : "{\"name\":\""); at = putS(o, at, cap, ps->name); at = putS(o, at, cap, "\",\"audio\":"); at = putS(o, at, cap, ps->audio ? "true" : "false");
      if (!ps->audio) { at = putS(o, at, cap, ",\"default\":"); at = putN(o, at, cap, ps->def); at = putS(o, at, cap, ",\"min\":"); at = putN(o, at, cap, ps->lo); at = putS(o, at, cap, ",\"max\":"); at = putN(o, at, cap, ps->hi); }
      at = putS(o, at, cap, "}");
    }
    at = putS(o, at, cap, "],\"choices\":{");
    for (int e = 0; e < 2; e++) {
      const char *name = e ? ts->e2 : ts->e1; const char *const *vals = e ? ts->v2 : ts->v1; if (!name) continue;
      if (e && ts->e1) at = putS(o, at, cap, ",");
      at = putS(o, at, cap, "\""); at = putS(o, at, cap, name); at = putS(o, at, cap, "\":[");
      for (int i = 0; vals[i]; i++) { at = putS(o, at, cap, i ? ",\"" : "\""); at = putS(o, at, cap, vals[i]); at = putS(o, at, cap, "\""); }
      at = putS(o, at, cap, "]");
    }
    at = putS(o, at, cap, "}}");
  }
  putS(o, at, cap, "]");
  return o;
}
