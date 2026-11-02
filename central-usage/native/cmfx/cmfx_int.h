/* cmfx_int.h - inside Central FX: our own maths (the same results on every processor and in WebAssembly, no libc),
 * a small JSON reader, and the code language's compiler and machine. */
#ifndef CMFX_INT_H
#define CMFX_INT_H

#define CM_CHUNK 128            /* the core works in pieces of at most this many samples */
#define CM_MAXBLOCKS 64
#define CM_MAXWIRES 256
#define CM_MAXPARAMS 32
#define CM_MAXPORTS 10
#define CM_MAXPROGS 8           /* code blocks per plugin */
#define CM_CODE_OPS 16384       /* instructions, all code blocks together */
#define CM_CODE_VARS 2048       /* variables, all code blocks together */
#define CM_CODE_BUDGET 4096     /* instructions a code block may run for one sample */
#define CM_LOOP_MAX 4096        /* iterations one loop(n) may run */
#define CM_MAXPOOL (16u << 20)  /* floats of delay / reverb / array memory per plugin (64 MB) */
#define CM_JSON_NODES 8192
#define CM_JSON_STR (192 * 1024)
#define CM_MAXJSON (512 * 1024)

/* ---- maths: computed in double from our own series, so x86, ARM and WebAssembly agree */
double cm_floor(double x);
double cm_sqrt(double x);
double cm_fabs(double x);
double cm_exp(double x);
double cm_log(double x);
double cm_sin(double x);
double cm_cos(double x);
double cm_tan(double x);
double cm_tanh(double x);
double cm_atan(double x);
double cm_atan2(double y, double x);
double cm_pow(double a, double b);
double cm_fmod(double a, double b);
float cm_db2lin(float db);
float cm_lin2db(float g);
#define CM_PI 3.14159265358979323846
int cm_isfinite(float x);
void cm_memset(void *p, int v, unsigned long n);
void cm_memcpy(void *d, const void *s, unsigned long n);
int cm_strlen(const char *s);
int cm_streq(const char *a, const char *b);
/* a tiny formatter for messages: %s %d and %% only */
void cm_fmt(char *out, int outLen, const char *fmt, ...);

/* ---- JSON: one document, nodes in a fixed pool */
enum { JN_NULL, JN_BOOL, JN_NUM, JN_STR, JN_ARR, JN_OBJ };
typedef struct { unsigned char type; int key; int first, next; int str; double num; } JNode;   /* key/str: offsets into the string pool (-1 none) */
typedef struct {
  JNode nodes[CM_JSON_NODES]; int nNodes;
  char strs[CM_JSON_STR]; int nStr;
  char err[160];
} Json;
int json_parse(Json *j, const char *s, int len);   /* the root node's index, or -1 (j->err) */
int json_get(Json *j, int obj, const char *key);    /* a member's node, or -1 */
const char *json_str(Json *j, int node);            /* NULL if not a string */
double json_num(Json *j, int node, double dflt);

/* ---- the code language: compiled to a small stack machine */
#define CV_INL 0
#define CV_INR 1
#define CV_OUTL 2
#define CV_OUTR 3
#define CV_SRATE 4
#define CV_C1 5          /* c1..c4: the code block's control inputs */
#define CV_PI 9
#define CV_BLOCK 10      /* samples in this block */
#define CV_PARAMS 11     /* then one per plugin knob (by its id), then the code's own variables */

typedef struct { int op, a, b; float k; } CInst;   /* a, b: a variable, a jump target, an array or a function; k: a number */
typedef struct {
  int base, nVars;                 /* its variables: vars[base .. base+nVars) of the shared area */
  int init, block, sample, end;    /* entry points into the shared instructions (-1 none) */
  int nArr; int arrSize[64]; int arrIsDelay[64]; long arrOff[64];   /* arrays and delay lines (offsets into the pool) */
  float *arr[64]; int dpos[64];
  unsigned long pool;              /* floats it needs */
  unsigned rng;
  int overBudget, badNumber, disabled; int runs, overRuns;
} CProg;
typedef struct {
  CInst ops[CM_CODE_OPS]; int nOps;
  float vars[CM_CODE_VARS]; int nVars;
  CProg progs[CM_MAXPROGS]; int nProgs;
  /* names the compiler knows: the plugin's knobs */
  int nParams; char paramIds[CM_MAXPARAMS][32];
  char varNames[CM_CODE_VARS][24];
} CCode;
/* compile one code text into a new program; -1 + err ("line N: ...") */
int code_compile(CCode *c, const char *src, int len, float sr, char *err, int errLen);
/* run a section: 0 fine, 1 over its budget */
int code_run(CCode *c, CProg *p, int entry);
void code_attach(CCode *c, CProg *p, float *pool, float sr);
void code_reset(CCode *c, CProg *p);
#endif
