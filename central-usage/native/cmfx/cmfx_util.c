/* cmfx_util.c - Central FX's own maths, text and JSON (no libc: the same file builds into WebAssembly).
 * Every function is plain IEEE double arithmetic from series, so x86, ARM and WebAssembly give the same numbers. */
#include <stdarg.h>
#include "cmfx_int.h"

typedef union { double d; unsigned long long u; } DU;
typedef union { float f; unsigned u; } FU;

double cm_floor(double x) { return __builtin_floor(x); }
double cm_sqrt(double x) { return x > 0 ? __builtin_sqrt(x) : 0; }
double cm_fabs(double x) { return __builtin_fabs(x); }
static double rnd(double x) { return cm_floor(x + 0.5); }

static double scale2(double x, int k) {   /* x * 2^k */
  while (k > 1000) { DU s; s.u = (unsigned long long)(1000 + 1023) << 52; x *= s.d; k -= 1000; }
  while (k < -1000) { DU s; s.u = (unsigned long long)(-1000 + 1023) << 52; x *= s.d; k += 1000; }
  DU s; s.u = (unsigned long long)(k + 1023) << 52; return x * s.d;
}
#define LN2HI 6.93147180369123816490e-01
#define LN2LO 1.90821492927058770002e-10
#define LN2 0.69314718055994530942
double cm_exp(double x) {
  if (x != x) return 0;
  if (x > 709.0) return 8.2e307;
  if (x < -745.0) return 0;
  double k = rnd(x / LN2), r = (x - k * LN2HI) - k * LN2LO;
  double t = 1, s = 1;
  for (int i = 1; i <= 11; i++) { t *= r / i; s += t; }
  return scale2(s, (int)k);
}
double cm_log(double x) {
  if (!(x > 0)) return -1000.0;          /* (safe: exp of it is 0) */
  if (x > 1.7e308) return 709.78;
  DU v; v.d = x; int e = (int)((v.u >> 52) & 0x7ff);
  if (e == 0) { v.d = x * 18014398509481984.0; e = (int)((v.u >> 52) & 0x7ff) - 54; }   /* subnormal: 2^54 */
  e -= 1023; v.u = (v.u & 0x000fffffffffffffULL) | 0x3ff0000000000000ULL;
  double m = v.d; if (m > 1.41421356237309504880) { m *= 0.5; e++; }
  double f = (m - 1) / (m + 1), s = f * f, term = f, sum = 0;
  for (int i = 1; i <= 23; i += 2) { sum += term / i; term *= s; }
  return e * LN2 + 2 * sum;
}
#define PIO2_1 1.57079632673412561417e+00
#define PIO2_1T 6.07710050650619224932e-11
static double sinp(double r) { double r2 = r * r, t = r, s = r; for (int i = 1; i <= 7; i++) { t *= -r2 / ((2 * i) * (2 * i + 1)); s += t; } return s; }
static double cosp(double r) { double r2 = r * r, t = 1, s = 1; for (int i = 1; i <= 7; i++) { t *= -r2 / ((2 * i - 1) * (2 * i)); s += t; } return s; }
static float SINT[4097]; static int sintReady;
void cm_tables_init(void) { if (sintReady) return; for (int i = 0; i <= 4096; i++) SINT[i] = (float)cm_sin(6.283185307179586 * i / 4096.0); sintReady = 1; }
float cm_tsin(double c) { c -= cm_floor(c); double x = c * 4096.0; int i = (int)x; float f = (float)(x - i); if (i > 4095) { i = 4095; f = 1; } return SINT[i] + (SINT[i + 1] - SINT[i]) * f; }
static int reduce(double x, double *r) {
  double n = rnd(x * 0.63661977236758134308); *r = (x - n * PIO2_1) - n * PIO2_1T;
  long long q = (long long)n; return (int)(q & 3);
}
double cm_sin(double x) {
  if (x != x || cm_fabs(x) > 1e9) return 0;
  double r; switch (reduce(x, &r)) { case 0: return sinp(r); case 1: return cosp(r); case 2: return -sinp(r); default: return -cosp(r); }
}
double cm_cos(double x) {
  if (x != x || cm_fabs(x) > 1e9) return 1;
  double r; switch (reduce(x, &r)) { case 0: return cosp(r); case 1: return -sinp(r); case 2: return -cosp(r); default: return sinp(r); }
}
double cm_tan(double x) { double c = cm_cos(x); if (cm_fabs(c) < 1e-12) c = c < 0 ? -1e-12 : 1e-12; return cm_sin(x) / c; }
double cm_tanh(double x) {
  if (x != x) return 0;
  if (x > 20) return 1; if (x < -20) return -1;
  if (cm_fabs(x) < 1e-6) return x;
  double e = cm_exp(2 * x); return (e - 1) / (e + 1);
}
static double atanr(double y) {   /* |y| <= tan(pi/8) */
  double y2 = y * y, t = y, s = 0;
  for (int i = 1; i <= 41; i += 2) { s += t / i; t *= -y2; }
  return s;
}
double cm_atan(double x) {
  if (x != x) return 0;
  int neg = x < 0; if (neg) x = -x;
  double r;
  if (x > 1) { double y = 1 / x; r = y > 0.41421356237309504880 ? CM_PI / 4 + atanr((y - 1) / (y + 1)) : atanr(y); r = CM_PI / 2 - r; }
  else r = x > 0.41421356237309504880 ? CM_PI / 4 + atanr((x - 1) / (x + 1)) : atanr(x);
  return neg ? -r : r;
}
double cm_atan2(double y, double x) {
  if (x > 0) return cm_atan(y / x);
  if (x < 0) return y >= 0 ? cm_atan(y / x) + CM_PI : cm_atan(y / x) - CM_PI;
  return y > 0 ? CM_PI / 2 : y < 0 ? -CM_PI / 2 : 0;
}
double cm_pow(double a, double b) {
  if (b == 0) return 1;
  if (a == 0) return b > 0 ? 0 : 8.2e307;
  if (a > 0) return cm_exp(b * cm_log(a));
  if (b == cm_floor(b)) { double v = cm_exp(b * cm_log(-a)); long long bi = (long long)b; return (bi & 1) ? -v : v; }
  return 0;
}
double cm_fmod(double a, double b) { if (b == 0) return 0; double q = a / b; q = q < 0 ? -cm_floor(-q) : cm_floor(q); return a - b * q; }
/* (10.3) quicker level <-> dB for the dynamics (per sample): a few multiplies on the float's own exponent and mantissa,
 * within 0.001 dB; the same bits on every processor */
float cm_fdb(float g) {
  if (!(g > 1e-10f)) return -200.0f;
  FU v; v.f = g; int e = (int)((v.u >> 23) & 0xff) - 127; v.u = (v.u & 0x007fffffu) | 0x3f800000u;
  float m = v.f, t = (m - 1) / (m + 1), t2 = t * t;
  float l2 = e + t * (2.8853900817779268f + t2 * (0.9617966939259756f + t2 * (0.5770780163555854f + t2 * (0.41219858311827f + t2 * 0.3205988f))));
  return 6.020599913279624f * l2;
}
float cm_fgain(float db) {
  if (db < -200) return 0; if (db > 200) db = 200;
  float x = db * 0.16609640474436813f, fl = (float)cm_floor(x), f = x - fl;   /* 2^x */
  float q = 1 + f * (0.6931471805599453f + f * (0.2402265069591007f + f * (0.0555041086648216f + f * (0.0096181291076285f + f * (0.0013333558146428f + f * 0.000154035303933816f)))));
  FU v; v.f = q; v.u += (unsigned)((int)fl) << 23; return v.f;
}
float cm_db2lin(float db) { return (float)cm_exp(db * 0.11512925464970228420); }
float cm_lin2db(float g) { return g <= 1e-10f ? -200.0f : (float)(8.68588963806503655302 * cm_log(g)); }
int cm_isfinite(float x) { FU v; v.f = x; return ((v.u >> 23) & 0xff) != 0xff; }

void cm_memset(void *p, int v, unsigned long n) { unsigned char *d = (unsigned char *)p; while (n--) *d++ = (unsigned char)v; }
void cm_memcpy(void *dst, const void *src, unsigned long n) { unsigned char *d = (unsigned char *)dst; const unsigned char *s = (const unsigned char *)src; while (n--) *d++ = *s++; }
int cm_strlen(const char *s) { int n = 0; if (s) while (s[n]) n++; return n; }
int cm_streq(const char *a, const char *b) { if (!a || !b) return 0; while (*a && *a == *b) { a++; b++; } return *a == *b; }

void cm_fmt(char *out, int outLen, const char *fmt, ...) {
  if (!out || outLen <= 0) return;
  va_list ap; va_start(ap, fmt); int o = 0;
#define PUT(c) do { if (o < outLen - 1) out[o++] = (c); } while (0)
  for (const char *f = fmt; *f; f++) {
    if (*f != '%') { PUT(*f); continue; }
    f++;
    if (*f == 's') { const char *s = va_arg(ap, const char *); if (!s) s = "(none)"; while (*s) PUT(*s++); }
    else if (*f == 'd') { int v = va_arg(ap, int); char b[16]; int n = 0; unsigned u = v < 0 ? (unsigned)(-(long long)v) : (unsigned)v; if (v < 0) PUT('-'); do { b[n++] = (char)('0' + u % 10); u /= 10; } while (u); while (n) PUT(b[--n]); }
    else if (*f == '%') PUT('%');
    else if (!*f) break;
  }
#undef PUT
  out[o] = 0; va_end(ap);
}

/* ---------------------------------------------------------------- JSON */
typedef struct { Json *j; const char *s; int len, pos, depth; } JP;
static void jerr(JP *p, const char *m) { if (!p->j->err[0]) cm_fmt(p->j->err, sizeof p->j->err, "the plugin file isn't valid JSON (%s, at character %d)", m, p->pos); }
static void ws(JP *p) { while (p->pos < p->len && (p->s[p->pos] == ' ' || p->s[p->pos] == '\t' || p->s[p->pos] == '\n' || p->s[p->pos] == '\r')) p->pos++; }
static int newNode(JP *p, int type) {
  if (p->j->nNodes >= CM_JSON_NODES) { jerr(p, "too many values"); return -1; }
  JNode *n = &p->j->nodes[p->j->nNodes]; n->type = (unsigned char)type; n->key = -1; n->first = -1; n->next = -1; n->str = -1; n->num = 0;
  return p->j->nNodes++;
}
static int putc8(JP *p, unsigned c) {
  Json *j = p->j; if (j->nStr + 5 >= CM_JSON_STR) { jerr(p, "too much text"); return -1; }
  if (c < 0x80) j->strs[j->nStr++] = (char)c;
  else if (c < 0x800) { j->strs[j->nStr++] = (char)(0xC0 | (c >> 6)); j->strs[j->nStr++] = (char)(0x80 | (c & 63)); }
  else if (c < 0x10000) { j->strs[j->nStr++] = (char)(0xE0 | (c >> 12)); j->strs[j->nStr++] = (char)(0x80 | ((c >> 6) & 63)); j->strs[j->nStr++] = (char)(0x80 | (c & 63)); }
  else { j->strs[j->nStr++] = (char)(0xF0 | (c >> 18)); j->strs[j->nStr++] = (char)(0x80 | ((c >> 12) & 63)); j->strs[j->nStr++] = (char)(0x80 | ((c >> 6) & 63)); j->strs[j->nStr++] = (char)(0x80 | (c & 63)); }
  return 0;
}
static int hex4(JP *p, unsigned *out) {
  unsigned v = 0; if (p->pos + 4 > p->len) return -1;
  for (int i = 0; i < 4; i++) { char c = p->s[p->pos++]; v <<= 4; if (c >= '0' && c <= '9') v |= (unsigned)(c - '0'); else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10); else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10); else return -1; }
  *out = v; return 0;
}
static int pstring(JP *p) {   /* at the opening quote; returns the offset in the pool */
  p->pos++; int start = p->j->nStr;
  while (p->pos < p->len) {
    unsigned char c = (unsigned char)p->s[p->pos++];
    if (c == '"') { if (p->j->nStr >= CM_JSON_STR) { jerr(p, "too much text"); return -1; } p->j->strs[p->j->nStr++] = 0; return start; }
    if (c < 0x20) { jerr(p, "a control character inside text"); return -1; }
    if (c == '\\') {
      if (p->pos >= p->len) break;
      char e = p->s[p->pos++]; unsigned u = 0;
      switch (e) {
        case '"': u = '"'; break; case '\\': u = '\\'; break; case '/': u = '/'; break; case 'b': u = 8; break; case 'f': u = 12; break;
        case 'n': u = 10; break; case 'r': u = 13; break; case 't': u = 9; break;
        case 'u': if (hex4(p, &u)) { jerr(p, "a bad \\u escape"); return -1; }
          if (u >= 0xD800 && u < 0xDC00 && p->pos + 6 <= p->len && p->s[p->pos] == '\\' && p->s[p->pos + 1] == 'u') { unsigned lo; p->pos += 2; if (hex4(p, &lo)) { jerr(p, "a bad \\u escape"); return -1; } u = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00); }
          break;
        default: jerr(p, "a bad escape"); return -1;
      }
      if (putc8(p, u)) return -1;
    } else { if (p->j->nStr >= CM_JSON_STR - 1) { jerr(p, "too much text"); return -1; } p->j->strs[p->j->nStr++] = (char)c; }
  }
  jerr(p, "text that never ends"); return -1;
}
static int pvalue(JP *p);
static int pvalue(JP *p) {
  ws(p); if (p->pos >= p->len) { jerr(p, "it ends too soon"); return -1; }
  if (++p->depth > 64) { jerr(p, "nested too deep"); return -1; }
  char c = p->s[p->pos]; int n = -1;
  if (c == '{') {
    n = newNode(p, JN_OBJ); if (n < 0) return -1; p->pos++; int last = -1; ws(p);
    if (p->pos < p->len && p->s[p->pos] == '}') { p->pos++; p->depth--; return n; }
    for (;;) {
      ws(p); if (p->pos >= p->len || p->s[p->pos] != '"') { jerr(p, "a name in quotes was expected"); return -1; }
      int k = pstring(p); if (k < 0) return -1; ws(p);
      if (p->pos >= p->len || p->s[p->pos] != ':') { jerr(p, "':' was expected"); return -1; } p->pos++;
      int v = pvalue(p); if (v < 0) return -1; p->j->nodes[v].key = k;
      if (last < 0) p->j->nodes[n].first = v; else p->j->nodes[last].next = v; last = v;
      ws(p); if (p->pos < p->len && p->s[p->pos] == ',') { p->pos++; continue; }
      if (p->pos < p->len && p->s[p->pos] == '}') { p->pos++; break; }
      jerr(p, "',' or '}' was expected"); return -1;
    }
  } else if (c == '[') {
    n = newNode(p, JN_ARR); if (n < 0) return -1; p->pos++; int last = -1; ws(p);
    if (p->pos < p->len && p->s[p->pos] == ']') { p->pos++; p->depth--; return n; }
    for (;;) {
      int v = pvalue(p); if (v < 0) return -1;
      if (last < 0) p->j->nodes[n].first = v; else p->j->nodes[last].next = v; last = v;
      ws(p); if (p->pos < p->len && p->s[p->pos] == ',') { p->pos++; continue; }
      if (p->pos < p->len && p->s[p->pos] == ']') { p->pos++; break; }
      jerr(p, "',' or ']' was expected"); return -1;
    }
  } else if (c == '"') { n = newNode(p, JN_STR); if (n < 0) return -1; int s = pstring(p); if (s < 0) return -1; p->j->nodes[n].str = s; }
  else if (c == 't' && p->pos + 4 <= p->len && p->s[p->pos + 1] == 'r' && p->s[p->pos + 2] == 'u' && p->s[p->pos + 3] == 'e') { n = newNode(p, JN_BOOL); if (n < 0) return -1; p->j->nodes[n].num = 1; p->pos += 4; }
  else if (c == 'f' && p->pos + 5 <= p->len && p->s[p->pos + 1] == 'a' && p->s[p->pos + 2] == 'l' && p->s[p->pos + 3] == 's' && p->s[p->pos + 4] == 'e') { n = newNode(p, JN_BOOL); if (n < 0) return -1; p->pos += 5; }
  else if (c == 'n' && p->pos + 4 <= p->len && p->s[p->pos + 1] == 'u' && p->s[p->pos + 2] == 'l' && p->s[p->pos + 3] == 'l') { n = newNode(p, JN_NULL); if (n < 0) return -1; p->pos += 4; }
  else if (c == '-' || (c >= '0' && c <= '9')) {
    n = newNode(p, JN_NUM); if (n < 0) return -1;
    int neg = 0; if (p->s[p->pos] == '-') { neg = 1; p->pos++; }
    double v = 0; int digits = 0;
    while (p->pos < p->len && p->s[p->pos] >= '0' && p->s[p->pos] <= '9') { v = v * 10 + (p->s[p->pos++] - '0'); digits++; }
    if (p->pos < p->len && p->s[p->pos] == '.') { p->pos++; double f = 0.1; while (p->pos < p->len && p->s[p->pos] >= '0' && p->s[p->pos] <= '9') { v += (p->s[p->pos++] - '0') * f; f *= 0.1; digits++; } }
    if (!digits) { jerr(p, "a bad number"); return -1; }
    if (p->pos < p->len && (p->s[p->pos] == 'e' || p->s[p->pos] == 'E')) {
      p->pos++; int en = 0, ev = 0; if (p->pos < p->len && (p->s[p->pos] == '+' || p->s[p->pos] == '-')) en = p->s[p->pos++] == '-';
      while (p->pos < p->len && p->s[p->pos] >= '0' && p->s[p->pos] <= '9') { if (ev < 400) ev = ev * 10 + (p->s[p->pos] - '0'); p->pos++; }
      v *= cm_pow(10, en ? -ev : ev);
    }
    p->j->nodes[n].num = neg ? -v : v;
  } else { jerr(p, "an unexpected character"); return -1; }
  p->depth--; return n;
}
int json_parse(Json *j, const char *s, int len) {
  j->nNodes = 0; j->nStr = 0; j->err[0] = 0;
  if (len > CM_MAXJSON) { cm_fmt(j->err, sizeof j->err, "the plugin file is too big (up to %d KB)", CM_MAXJSON / 1024); return -1; }
  JP p = { j, s, len, 0, 0 }; int r = pvalue(&p); if (r < 0) return -1;
  ws(&p); if (p.pos != len) { jerr(&p, "something after the end"); return -1; }
  return r;
}
int json_get(Json *j, int obj, const char *key) {
  if (obj < 0 || j->nodes[obj].type != JN_OBJ) return -1;
  for (int c = j->nodes[obj].first; c >= 0; c = j->nodes[c].next) if (j->nodes[c].key >= 0 && cm_streq(j->strs + j->nodes[c].key, key)) return c;
  return -1;
}
const char *json_str(Json *j, int n) { return n >= 0 && j->nodes[n].type == JN_STR ? j->strs + j->nodes[n].str : 0; }
double json_num(Json *j, int n, double d) { if (n < 0) return d; if (j->nodes[n].type == JN_NUM || j->nodes[n].type == JN_BOOL) return j->nodes[n].num; return d; }
