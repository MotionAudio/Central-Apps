/* cmfx_code.c - Central FX's code language: a small, safe language for sound, in the spirit of JSFX / EEL.
 *
 *   @init          runs once when the plugin starts (and when it is reset)
 *   @block         runs once per block of samples (at most 128)
 *   @sample        runs for every sample (the default when there are no sections)
 *
 *   outL = inL * 0.5;                      numbers, + - * / % ^, == != < > <= >=, && || !, c ? a : b
 *   gain += 0.1;                           = += -= *= /= ; variables appear when first used (they start at 0)
 *   array buf[1024];                       an array (up to 65536 numbers; buf[i] wraps around)
 *   delay echo[2000];                      a delay line of up to 2000 ms: echo.write(x), echo.read(ms)
 *   if (x > 0.5) { ... } else { ... }      loop (16) { ... }  (at most 4096 times)
 *   sin cos tan tanh exp log log10 log2 sqrt abs floor ceil round sign atan atan2 pow min max clamp mix fmod
 *   db2gain gain2db rand() noise() len(buf)
 *   Read-only: inL inR srate c1..c4 (the block's control inputs) pi blocksize and every knob by its id.
 *
 * There are no files, no network, no system calls; loops are bounded and each sample may run at most
 * CM_CODE_BUDGET instructions, so a script can't hang or crash the program it plays in. Statements end with ';'
 * or a new line; // and slash-star comments. */
#include "cmfx_int.h"

enum { OP_K, OP_LD, OP_ST, OP_POP, OP_DUP, OP_ADD, OP_SUB, OP_MUL, OP_DIV, OP_MOD, OP_POW, OP_NEG, OP_NOT, OP_NE0,
  OP_EQ, OP_NE, OP_LT, OP_GT, OP_LE, OP_GE, OP_JMP, OP_JZ, OP_CALL, OP_AL, OP_AS, OP_DW, OP_DR, OP_LEN, OP_LOOPI, OP_LOOPC, OP_END };
enum { F_SIN, F_COS, F_TAN, F_TANH, F_EXP, F_LOG, F_LOG10, F_LOG2, F_SQRT, F_ABS, F_FLOOR, F_CEIL, F_ROUND, F_SIGN, F_ATAN,
  F_DB2GAIN, F_GAIN2DB, F_POW, F_MIN, F_MAX, F_ATAN2, F_FMOD, F_CLAMP, F_MIX, F_RAND, F_NOISE };
static const struct { const char *name; int n; int id; } FUNCS[] = {
  { "sin", 1, F_SIN }, { "cos", 1, F_COS }, { "tan", 1, F_TAN }, { "tanh", 1, F_TANH }, { "exp", 1, F_EXP }, { "log", 1, F_LOG },
  { "log10", 1, F_LOG10 }, { "log2", 1, F_LOG2 }, { "sqrt", 1, F_SQRT }, { "abs", 1, F_ABS }, { "floor", 1, F_FLOOR }, { "ceil", 1, F_CEIL },
  { "round", 1, F_ROUND }, { "sign", 1, F_SIGN }, { "atan", 1, F_ATAN }, { "db2gain", 1, F_DB2GAIN }, { "gain2db", 1, F_GAIN2DB },
  { "pow", 2, F_POW }, { "min", 2, F_MIN }, { "max", 2, F_MAX }, { "atan2", 2, F_ATAN2 }, { "fmod", 2, F_FMOD }, { "clamp", 3, F_CLAMP },
  { "mix", 3, F_MIX }, { "rand", 0, F_RAND }, { "noise", 0, F_NOISE }, { 0, 0, 0 } };
static const char *BUILTIN[CV_PARAMS] = { "inL", "inR", "outL", "outR", "srate", "c1", "c2", "c3", "c4", "pi", "blocksize" };

/* ---------------------------------------------------------------- the lexer */
enum { T_EOF, T_NUM, T_ID, T_OP, T_NL, T_SECT };
typedef struct { int t; double num; char s[32]; int line; } Tok;
typedef struct {
  CCode *c; CProg *p; const char *src; int len, pos, line, paren; Tok tok, peek; int hasPeek;
  char *err; int errLen; int failed; int depth;
  int lvKind, lvOp, lvVar;                    /* the last thing parsed, if it can be assigned to (1 var, 2 array element) */
  char arrNames[64][24];
  float sr;
} CS;
static void fail(CS *s, int line, const char *m, const char *a) {
  if (s->failed) return; s->failed = 1;
  char b[200]; cm_fmt(b, sizeof b, m, a); cm_fmt(s->err, s->errLen, "line %d: %s", line, b);
}
static int isAl(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
static int isDig(char c) { return c >= '0' && c <= '9'; }
static void lexRaw(CS *s, Tok *t) {
  for (;;) {
    while (s->pos < s->len && (s->src[s->pos] == ' ' || s->src[s->pos] == '\t' || s->src[s->pos] == '\r')) s->pos++;
    if (s->pos + 1 < s->len && s->src[s->pos] == '/' && s->src[s->pos + 1] == '/') { while (s->pos < s->len && s->src[s->pos] != '\n') s->pos++; continue; }
    if (s->pos + 1 < s->len && s->src[s->pos] == '/' && s->src[s->pos + 1] == '*') {
      int line = s->line; s->pos += 2;
      while (s->pos + 1 < s->len && !(s->src[s->pos] == '*' && s->src[s->pos + 1] == '/')) { if (s->src[s->pos] == '\n') s->line++; s->pos++; }
      if (s->pos + 1 >= s->len) { fail(s, line, "a comment that never ends (it needs */)%s", ""); t->t = T_EOF; return; }
      s->pos += 2; continue;
    }
    break;
  }
  t->line = s->line; t->s[0] = 0;
  if (s->pos >= s->len) { t->t = T_EOF; return; }
  char c = s->src[s->pos];
  if (c == '\n') { s->pos++; s->line++; t->t = T_NL; return; }
  if (isDig(c) || (c == '.' && s->pos + 1 < s->len && isDig(s->src[s->pos + 1]))) {
    double v = 0; while (s->pos < s->len && isDig(s->src[s->pos])) v = v * 10 + (s->src[s->pos++] - '0');
    if (s->pos < s->len && s->src[s->pos] == '.') { s->pos++; double f = 0.1; while (s->pos < s->len && isDig(s->src[s->pos])) { v += (s->src[s->pos++] - '0') * f; f *= 0.1; } }
    if (s->pos < s->len && (s->src[s->pos] == 'e' || s->src[s->pos] == 'E') && s->pos + 1 < s->len && (isDig(s->src[s->pos + 1]) || ((s->src[s->pos + 1] == '-' || s->src[s->pos + 1] == '+') && s->pos + 2 < s->len && isDig(s->src[s->pos + 2])))) {
      s->pos++; int neg = 0, e = 0; if (s->src[s->pos] == '-' || s->src[s->pos] == '+') neg = s->src[s->pos++] == '-';
      while (s->pos < s->len && isDig(s->src[s->pos])) { if (e < 400) e = e * 10 + (s->src[s->pos] - '0'); s->pos++; }
      v *= cm_pow(10, neg ? -e : e);
    }
    t->t = T_NUM; t->num = v; return;
  }
  if (isAl(c) || c == '@') {
    int n = 0; int sect = c == '@'; if (sect) s->pos++;
    while (s->pos < s->len && (isAl(s->src[s->pos]) || isDig(s->src[s->pos]))) { if (n < 31) t->s[n++] = s->src[s->pos]; s->pos++; }
    t->s[n] = 0; t->t = sect ? T_SECT : T_ID; return;
  }
  static const char *two[] = { "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", 0 };
  for (int i = 0; two[i]; i++) if (s->pos + 1 < s->len && s->src[s->pos] == two[i][0] && s->src[s->pos + 1] == two[i][1]) { t->t = T_OP; t->s[0] = two[i][0]; t->s[1] = two[i][1]; t->s[2] = 0; s->pos += 2; return; }
  if (c == '+' || c == '-' || c == '*' || c == '/' || c == '%' || c == '^' || c == '<' || c == '>' || c == '=' || c == '!' || c == '?' || c == ':' || c == '(' || c == ')' || c == '[' || c == ']' || c == '{' || c == '}' || c == ';' || c == ',' || c == '.') {
    t->t = T_OP; t->s[0] = c; t->s[1] = 0; s->pos++; return;
  }
  char b[2] = { c, 0 }; fail(s, s->line, "the character '%s' can't be used here", b); t->t = T_EOF; s->pos = s->len;
}
static void next(CS *s) {
  if (s->hasPeek) { s->tok = s->peek; s->hasPeek = 0; } else lexRaw(s, &s->tok);
  /* a new line inside ( ) or [ ] is just a space */
  while (s->tok.t == T_NL && s->paren > 0) lexRaw(s, &s->tok);
  if (s->tok.t == T_OP) { char c = s->tok.s[0]; if (!s->tok.s[1]) { if (c == '(' || c == '[') s->paren++; else if ((c == ')' || c == ']') && s->paren > 0) s->paren--; } }
}
static int isOp(CS *s, const char *o) { return s->tok.t == T_OP && cm_streq(s->tok.s, o); }
static void skipNl(CS *s) { while (s->tok.t == T_NL) next(s); }
static void expect(CS *s, const char *o, const char *what) { if (!isOp(s, o)) { fail(s, s->tok.line, "%s", what); return; } next(s); }

/* ---------------------------------------------------------------- code generation */
static int emitA(CS *s, int op, int a, float k) {
  if (s->c->nOps >= CM_CODE_OPS) { fail(s, s->tok.line, "the code is too long%s", ""); return 0; }
  CInst *in = &s->c->ops[s->c->nOps]; in->op = op; in->a = a; in->b = 0; in->k = k; s->lvKind = 0; return s->c->nOps++;
}
#define emit(s, op, k) emitA(s, op, 0, k)
#define emitI(s, op, a) emitA(s, op, a, 0)
static void patch(CS *s, int at) { s->c->ops[at].a = s->c->nOps; }
static int varIndex(CS *s, const char *name, int create) {
  CProg *p = s->p; CCode *c = s->c;
  for (int i = 0; i < p->nVars; i++) if (cm_streq(c->varNames[p->base + i], name)) return i;
  if (!create) return -1;
  if (p->base + p->nVars >= CM_CODE_VARS) { fail(s, s->tok.line, "too many variables%s", ""); return 0; }
  int n = cm_strlen(name); if (n > 23) n = 23; cm_memcpy(c->varNames[p->base + p->nVars], name, (unsigned long)n); c->varNames[p->base + p->nVars][n] = 0;
  return p->nVars++;
}
static int arrIndex(CS *s, const char *name) { for (int i = 0; i < s->p->nArr; i++) if (cm_streq(s->arrNames[i], name)) return i; return -1; }
static int funcIndex(const char *name) { for (int i = 0; FUNCS[i].name; i++) if (cm_streq(FUNCS[i].name, name)) return i; return -1; }

static void expr(CS *s);
static void primary(CS *s) {
  skipNl(s);
  int line = s->tok.line;
  if (++s->depth > 40) { fail(s, line, "this expression is nested too deep%s", ""); return; }
  if (s->tok.t == T_NUM) { emit(s, OP_K, (float)s->tok.num); next(s); }
  else if (isOp(s, "(")) { next(s); expr(s); int kind = s->lvKind, op = s->lvOp, v = s->lvVar; expect(s, ")", "a ')' is missing"); s->lvKind = kind; s->lvOp = op; s->lvVar = v; }
  else if (s->tok.t == T_ID) {
    char name[32]; cm_memcpy(name, s->tok.s, 32); next(s);
    if (isOp(s, "(")) {   /* a function call */
      next(s);
      if (cm_streq(name, "len")) {
        int a = s->tok.t == T_ID ? arrIndex(s, s->tok.s) : -1; if (a < 0) { fail(s, line, "len() needs the name of an array or delay%s", ""); return; }
        next(s); expect(s, ")", "a ')' is missing"); emitI(s, OP_LEN, a); s->depth--; return;
      }
      int f = funcIndex(name);
      if (f < 0 && (cm_streq(name, "while") || cm_streq(name, "for"))) { fail(s, line, "there is no %s here: use loop (count) { ... }", name); return; }
      if (f < 0) { fail(s, line, "I don't know the function '%s'", name); return; }
      int n = 0;
      if (!isOp(s, ")")) for (;;) { expr(s); n++; if (isOp(s, ",")) { next(s); continue; } break; }
      expect(s, ")", "a ')' is missing");
      if (n != FUNCS[f].n) { char b[64]; cm_fmt(b, sizeof b, "%s() takes %d number%s", name, FUNCS[f].n, FUNCS[f].n == 1 ? "" : "s"); fail(s, line, "%s", b); return; }
      emitI(s, OP_CALL, FUNCS[f].id);
    } else {
      int a = arrIndex(s, name);
      if (a >= 0) {
        if (isOp(s, "[")) {
          if (s->p->arrIsDelay[a]) { fail(s, line, "%s is a delay line: use .read(ms) and .write(x) on it", name); return; }
          next(s); expr(s); expect(s, "]", "a ']' is missing");
          int op = emitI(s, OP_AL, a); s->lvKind = 2; s->lvOp = op; s->lvVar = a;
        } else if (isOp(s, ".")) {
          next(s); if (s->tok.t != T_ID) { fail(s, line, "read or write was expected after '.'%s", ""); return; }
          char m[32]; cm_memcpy(m, s->tok.s, 32); next(s);
          if (!s->p->arrIsDelay[a]) { fail(s, line, "%s is an array: use it with [i]", name); return; }
          expect(s, "(", "a '(' is missing"); expr(s); expect(s, ")", "a ')' is missing");
          if (cm_streq(m, "read")) emitI(s, OP_DR, a);
          else if (cm_streq(m, "write")) emitI(s, OP_DW, a);
          else { fail(s, line, "a delay line has read(ms) and write(x), not %s", m); return; }
        } else { fail(s, line, "%s is an array or a delay line: use [i], .read(ms) or .write(x)", name); return; }
      } else {
        if (cm_streq(name, "array") || cm_streq(name, "delay") || cm_streq(name, "if") || cm_streq(name, "else") || cm_streq(name, "loop")) { fail(s, line, "'%s' can't be used here", name); return; }
        if (isOp(s, ".")) { fail(s, line, "%s isn't a delay line yet: declare it first, e.g. delay echo[500]", name); return; }
        if (isOp(s, "[")) { fail(s, line, "%s isn't an array yet: declare it first, e.g. array buf[64]", name); return; }
        int v = varIndex(s, name, 1); int op = emitI(s, OP_LD, v); s->lvKind = 1; s->lvOp = op; s->lvVar = v;
      }
    }
  } else if (s->tok.t == T_EOF) fail(s, line, "the code ends in the middle of something%s", "");
  else if (s->tok.t == T_SECT) fail(s, line, "@%s can only start a line, before any statement", s->tok.s);
  else fail(s, line, "I didn't expect '%s' here", s->tok.s);
  s->depth--;
}
static void unary(CS *s);
static void power(CS *s) {
  primary(s);
  if (isOp(s, "^")) { next(s); unary(s); emit(s, OP_POW, 0); }
}
static void unary(CS *s) {
  skipNl(s);
  if (isOp(s, "-")) { next(s); unary(s); emit(s, OP_NEG, 0); }
  else if (isOp(s, "!")) { next(s); unary(s); emit(s, OP_NOT, 0); }
  else if (isOp(s, "+")) { next(s); unary(s); }
  else power(s);
}
static void mul(CS *s) {
  unary(s);
  while (!s->failed && (isOp(s, "*") || isOp(s, "/") || isOp(s, "%"))) { char o = s->tok.s[0]; next(s); unary(s); emit(s, o == '*' ? OP_MUL : o == '/' ? OP_DIV : OP_MOD, 0); }
}
static void add(CS *s) {
  mul(s);
  while (!s->failed && (isOp(s, "+") || isOp(s, "-"))) { char o = s->tok.s[0]; next(s); mul(s); emit(s, o == '+' ? OP_ADD : OP_SUB, 0); }
}
static void cmp(CS *s) {
  add(s);
  while (!s->failed) {
    int op = isOp(s, "==") ? OP_EQ : isOp(s, "!=") ? OP_NE : isOp(s, "<") ? OP_LT : isOp(s, ">") ? OP_GT : isOp(s, "<=") ? OP_LE : isOp(s, ">=") ? OP_GE : -1;
    if (op < 0) break; next(s); add(s); emit(s, op, 0);
  }
}
static void and_(CS *s) {
  cmp(s);
  while (!s->failed && isOp(s, "&&")) {
    next(s); int jz = emit(s, OP_JZ, 0); cmp(s); emit(s, OP_NE0, 0); int j = emit(s, OP_JMP, 0);
    patch(s, jz); emit(s, OP_K, 0); patch(s, j);
  }
}
static void or_(CS *s) {
  and_(s);
  while (!s->failed && isOp(s, "||")) {
    next(s); int jz = emit(s, OP_JZ, 0); emit(s, OP_K, 1); int j = emit(s, OP_JMP, 0);
    patch(s, jz); and_(s); emit(s, OP_NE0, 0); patch(s, j);
  }
}
static void ternary(CS *s) {
  or_(s);
  if (!s->failed && isOp(s, "?")) {
    next(s); int jz = emit(s, OP_JZ, 0); expr(s); int j = emit(s, OP_JMP, 0);
    skipNl(s); expect(s, ":", "a ':' is missing (c ? a : b)");
    patch(s, jz); expr(s); patch(s, j); s->lvKind = 0;
  }
}
static int readOnly(int v) { return v < CV_PARAMS + 0 ? !(v == CV_OUTL || v == CV_OUTR) : 0; }
static void expr(CS *s) {
  ternary(s);
  if (s->failed) return;
  int asg = isOp(s, "=") ? 1 : isOp(s, "+=") ? OP_ADD : isOp(s, "-=") ? OP_SUB : isOp(s, "*=") ? OP_MUL : isOp(s, "/=") ? OP_DIV : 0;
  if (!asg) return;
  int line = s->tok.line;
  if (!s->lvKind || s->lvOp != s->c->nOps - 1) { fail(s, line, "only a variable or an array element can be given a value%s", ""); return; }
  int kind = s->lvKind, v = s->lvVar;
  if (kind == 1) {
    if (readOnly(v) || (v >= CV_PARAMS && v < CV_PARAMS + s->c->nParams)) { fail(s, line, "%s can't be changed here (it is read-only)", s->c->varNames[s->p->base + v]); return; }
    next(s);
    if (asg == 1) { s->c->nOps--; expr(s); emitI(s, OP_ST, v); }
    else { expr(s); emit(s, asg, 0); emitI(s, OP_ST, v); }
  } else {
    next(s);
    if (asg == 1) { s->c->nOps--; expr(s); emitI(s, OP_AS, v); }
    else { s->c->ops[s->c->nOps - 1].op = OP_DUP; emitI(s, OP_AL, v); expr(s); emit(s, asg, 0); emitI(s, OP_AS, v); }
  }
  s->lvKind = 0;
}

static void statement(CS *s);
static void endStatement(CS *s) {
  if (isOp(s, ";")) { next(s); return; }
  if (s->tok.t == T_NL) { next(s); return; }
  if (isOp(s, "}") || s->tok.t == T_EOF || s->tok.t == T_SECT || (s->tok.t == T_ID && cm_streq(s->tok.s, "else"))) return;
  fail(s, s->tok.line, "a ';' or a new line is missing before '%s'", s->tok.t == T_ID || s->tok.t == T_OP ? s->tok.s : "this");
}
static void blockOrStatement(CS *s) {
  skipNl(s);
  if (isOp(s, "{")) {
    int line = s->tok.line; next(s);
    for (;;) { skipNl(s); if (s->failed) return; if (isOp(s, "}")) { next(s); break; } if (s->tok.t == T_EOF || s->tok.t == T_SECT) { fail(s, line, "a '{' here is never closed with '}'%s", ""); return; } statement(s); }
  } else statement(s);
}
static void declare(CS *s, int isDelay) {
  int line = s->tok.line; next(s);
  if (s->tok.t != T_ID) { fail(s, line, "a name was expected after '%s'", isDelay ? "delay" : "array"); return; }
  char name[32]; cm_memcpy(name, s->tok.s, 32); next(s);
  if (arrIndex(s, name) >= 0 || varIndex(s, name, 0) >= 0 || funcIndex(name) >= 0) { fail(s, line, "the name %s is already used", name); return; }
  expect(s, "[", isDelay ? "write the longest delay in ms in [ ], e.g. delay echo[2000]" : "write the size in [ ], e.g. array buf[1024]");
  if (s->tok.t != T_NUM) { fail(s, line, "the size must be a number%s", ""); return; }
  double n = s->tok.num; next(s); expect(s, "]", "a ']' is missing");
  if (s->p->nArr >= 64) { fail(s, line, "too many arrays and delays (up to 64)%s", ""); return; }
  long size;
  if (isDelay) { if (n < 1 || n > 10000) { fail(s, line, "a delay line can be 1 to 10000 ms long%s", ""); return; } size = (long)(n * s->sr / 1000.0) + 4; }
  else { if (n < 1 || n > 65536) { fail(s, line, "an array can hold 1 to 65536 numbers%s", ""); return; } size = (long)n; }
  int a = s->p->nArr++; int l = cm_strlen(name); if (l > 23) l = 23; cm_memcpy(s->arrNames[a], name, (unsigned long)l); s->arrNames[a][l] = 0;
  s->p->arrSize[a] = (int)size; s->p->arrIsDelay[a] = isDelay; s->p->arrOff[a] = (long)s->p->pool; s->p->pool += (unsigned long)size;
  endStatement(s);
}
static void statement(CS *s) {
  skipNl(s); if (s->failed) return;
  int line = s->tok.line;
  if (s->tok.t == T_ID && cm_streq(s->tok.s, "array")) { declare(s, 0); return; }
  if (s->tok.t == T_ID && cm_streq(s->tok.s, "delay")) { declare(s, 1); return; }
  if (s->tok.t == T_ID && cm_streq(s->tok.s, "if")) {
    next(s); if (!isOp(s, "(")) { fail(s, line, "if needs a condition in ( )%s", ""); return; }
    next(s); expr(s); expect(s, ")", "a ')' is missing after the condition");
    int jz = emit(s, OP_JZ, 0); blockOrStatement(s);
    /* else may follow on the next line (new lines between statements are only separators) */
    skipNl(s);
    if (s->tok.t == T_ID && cm_streq(s->tok.s, "else")) {
      next(s); int j = emitI(s, OP_JMP, 0); patch(s, jz); blockOrStatement(s); patch(s, j);
    } else patch(s, jz);
    return;
  }
  if (s->tok.t == T_ID && cm_streq(s->tok.s, "loop")) {
    next(s); if (!isOp(s, "(")) { fail(s, line, "loop needs a count in ( ), e.g. loop (8) { ... }%s", ""); return; }
    next(s); expr(s); expect(s, ")", "a ')' is missing after the count");
    char hidden[24]; cm_fmt(hidden, sizeof hidden, " loop%d", s->c->nOps); int v = varIndex(s, hidden, 1);
    emitI(s, OP_LOOPI, v); int top = s->c->nOps; int chk = emitI(s, OP_LOOPC, v);
    blockOrStatement(s); emitI(s, OP_JMP, top);
    s->c->ops[chk].b = s->c->nOps;   /* where it goes when the count runs out */
    return;
  }
  if (s->tok.t == T_ID && cm_streq(s->tok.s, "else")) { fail(s, line, "else without an if before it%s", ""); return; }
  if (isOp(s, "{")) { blockOrStatement(s); return; }
  if (isOp(s, ";")) { next(s); return; }
  expr(s); if (s->failed) return; emit(s, OP_POP, 0); endStatement(s);
}

int code_compile(CCode *c, const char *src, int len, float sr, char *err, int errLen) {
  if (c->nProgs >= CM_MAXPROGS) { cm_fmt(err, errLen, "a plugin can have up to %d code blocks", CM_MAXPROGS); return -1; }
  if (len > 64 * 1024) { cm_fmt(err, errLen, "the code is too long (up to 64 KB)"); return -1; }
  CProg *p = &c->progs[c->nProgs]; cm_memset(p, 0, sizeof *p);
  p->base = c->nVars; p->init = p->block = p->sample = -1; p->rng = 0x9E3779B9u ^ (unsigned)(c->nProgs * 7919 + 1);
  if (p->base + CV_PARAMS + c->nParams >= CM_CODE_VARS) { cm_fmt(err, errLen, "too many variables"); return -1; }
  for (int i = 0; i < CV_PARAMS; i++) { int n = cm_strlen(BUILTIN[i]); cm_memcpy(c->varNames[p->base + i], BUILTIN[i], (unsigned long)n + 1); }
  for (int i = 0; i < c->nParams; i++) { int n = cm_strlen(c->paramIds[i]); if (n > 23) n = 23; cm_memcpy(c->varNames[p->base + CV_PARAMS + i], c->paramIds[i], (unsigned long)n); c->varNames[p->base + CV_PARAMS + i][n] = 0; }
  p->nVars = CV_PARAMS + c->nParams;
  CS s0; CS *s = &s0; cm_memset(s, 0, sizeof *s);
  s->c = c; s->p = p; s->src = src; s->len = len; s->line = 1; s->err = err; s->errLen = errLen; s->sr = sr > 0 ? sr : 48000;
  int startOps = c->nOps;
  next(s);
  int sect = 2;   /* 0 init 1 block 2 sample */
  int entries[3] = { -1, -1, -1 };
  int cur = c->nOps;
  for (;;) {
    skipNl(s); if (s->failed) break;
    if (s->tok.t == T_SECT) {
      int ns = cm_streq(s->tok.s, "init") ? 0 : cm_streq(s->tok.s, "block") ? 1 : cm_streq(s->tok.s, "sample") ? 2 : -1;
      if (ns < 0) { fail(s, s->tok.line, "@%s isn't a section (use @init, @block or @sample)", s->tok.s); break; }
      if (c->nOps > cur || entries[sect] >= 0) { emit(s, OP_END, 0); if (entries[sect] < 0) entries[sect] = cur; }
      if (entries[ns] >= 0) { fail(s, s->tok.line, "@%s appears twice", s->tok.s); break; }
      sect = ns; cur = c->nOps; next(s); continue;
    }
    if (s->tok.t == T_EOF) break;
    if (isOp(s, "}")) { fail(s, s->tok.line, "a '}' without a '{' before it%s", ""); break; }
    statement(s);
  }
  if (!s->failed && c->nOps > cur) { emit(s, OP_END, 0); if (entries[sect] < 0) entries[sect] = cur; }
  if (s->failed) { c->nOps = startOps; return -1; }
  p->init = entries[0]; p->block = entries[1]; p->sample = entries[2]; p->end = c->nOps;
  if (p->pool > (1u << 22)) { cm_fmt(err, errLen, "the code's arrays and delays are too big together"); c->nOps = startOps; return -1; }
  c->nVars = p->base + p->nVars; c->nProgs++;
  return c->nProgs - 1;
}

void code_attach(CCode *c, CProg *p, float *pool, float sr) {
  (void)sr;
  for (int a = 0; a < p->nArr; a++) { p->arr[a] = pool + p->arrOff[a]; p->dpos[a] = 0; }
  code_reset(c, p);
}
void code_reset(CCode *c, CProg *p) {
  for (int i = CV_PARAMS + c->nParams; i < p->nVars; i++) c->vars[p->base + i] = 0;
  for (int a = 0; a < p->nArr; a++) { if (p->arr[a]) cm_memset(p->arr[a], 0, sizeof(float) * (unsigned long)p->arrSize[a]); p->dpos[a] = 0; }
  p->badNumber = 0; p->overBudget = 0; p->disabled = 0; p->runs = p->overRuns = 0;
  if (p->init >= 0) code_run(c, p, p->init);
}

static float callF(CProg *p, int f, float *a) {
  double x = a[0];
  switch (f) {
    case F_SIN: return (float)cm_sin(x); case F_COS: return (float)cm_cos(x); case F_TAN: return (float)cm_tan(x); case F_TANH: return (float)cm_tanh(x);
    case F_EXP: return (float)cm_exp(x); case F_LOG: return (float)cm_log(x); case F_LOG10: return (float)(cm_log(x) * 0.43429448190325182765);
    case F_LOG2: return (float)(cm_log(x) * 1.44269504088896340736); case F_SQRT: return (float)cm_sqrt(x); case F_ABS: return (float)cm_fabs(x);
    case F_FLOOR: return (float)cm_floor(x); case F_CEIL: return (float)-cm_floor(-x); case F_ROUND: return (float)cm_floor(x + 0.5);
    case F_SIGN: return x > 0 ? 1.0f : x < 0 ? -1.0f : 0.0f; case F_ATAN: return (float)cm_atan(x);
    case F_DB2GAIN: return cm_db2lin(a[0]); case F_GAIN2DB: return cm_lin2db(a[0] < 0 ? -a[0] : a[0]);
    case F_POW: return (float)cm_pow(x, a[1]); case F_MIN: return a[0] < a[1] ? a[0] : a[1]; case F_MAX: return a[0] > a[1] ? a[0] : a[1];
    case F_ATAN2: return (float)cm_atan2(x, a[1]); case F_FMOD: return (float)cm_fmod(x, a[1]);
    case F_CLAMP: return a[0] < a[1] ? a[1] : a[0] > a[2] ? a[2] : a[0];
    case F_MIX: return a[0] + (a[1] - a[0]) * a[2];
    case F_RAND: case F_NOISE: { unsigned r = p->rng; r ^= r << 13; r ^= r >> 17; r ^= r << 5; p->rng = r; float u = (float)(r >> 8) * (1.0f / 16777216.0f); return f == F_RAND ? u : u * 2 - 1; }
  }
  return 0;
}
static int nargs(int f) { for (int i = 0; FUNCS[i].name; i++) if (FUNCS[i].id == f) return FUNCS[i].n; return 0; }

int code_run(CCode *c, CProg *p, int entry) {
  if (entry < 0) return 0;
  float st[64]; int sp = 0, pc = entry, budget = CM_CODE_BUDGET; float *v = c->vars + p->base;
#define PUSH(x) do { if (sp >= 63) return 1; st[sp++] = (x); } while (0)
  for (;;) {
    if (--budget < 0) return 1;
    CInst in = c->ops[pc++];
    switch (in.op) {
      case OP_K: PUSH(in.k); break;
      case OP_LD: PUSH(v[in.a]); break;
      case OP_ST: v[in.a] = st[sp - 1]; break;
      case OP_POP: sp--; break;
      case OP_DUP: { float t = st[sp - 1]; PUSH(t); break; }
      case OP_ADD: sp--; st[sp - 1] += st[sp]; break;
      case OP_SUB: sp--; st[sp - 1] -= st[sp]; break;
      case OP_MUL: sp--; st[sp - 1] *= st[sp]; break;
      case OP_DIV: sp--; st[sp - 1] = st[sp] != 0 ? st[sp - 1] / st[sp] : 0; break;
      case OP_MOD: sp--; st[sp - 1] = (float)cm_fmod(st[sp - 1], st[sp]); break;
      case OP_POW: sp--; st[sp - 1] = (float)cm_pow(st[sp - 1], st[sp]); break;
      case OP_NEG: st[sp - 1] = -st[sp - 1]; break;
      case OP_NOT: st[sp - 1] = st[sp - 1] == 0 ? 1.0f : 0.0f; break;
      case OP_NE0: st[sp - 1] = st[sp - 1] != 0 ? 1.0f : 0.0f; break;
      case OP_EQ: sp--; st[sp - 1] = st[sp - 1] == st[sp] ? 1.0f : 0.0f; break;
      case OP_NE: sp--; st[sp - 1] = st[sp - 1] != st[sp] ? 1.0f : 0.0f; break;
      case OP_LT: sp--; st[sp - 1] = st[sp - 1] < st[sp] ? 1.0f : 0.0f; break;
      case OP_GT: sp--; st[sp - 1] = st[sp - 1] > st[sp] ? 1.0f : 0.0f; break;
      case OP_LE: sp--; st[sp - 1] = st[sp - 1] <= st[sp] ? 1.0f : 0.0f; break;
      case OP_GE: sp--; st[sp - 1] = st[sp - 1] >= st[sp] ? 1.0f : 0.0f; break;
      case OP_JMP: pc = in.a; break;
      case OP_JZ: sp--; if (st[sp] == 0) pc = in.a; break;
      case OP_CALL: { int f = in.a, n = nargs(f); float a[3] = { 0, 0, 0 }; for (int i = n - 1; i >= 0; i--) a[i] = st[--sp]; PUSH(callF(p, f, a)); break; }
      case OP_AL: case OP_AS: case OP_LEN: case OP_DW: case OP_DR: {
        int a = in.a, size = p->arrSize[a]; float *buf = p->arr[a];
        if (in.op == OP_LEN) { PUSH(p->arrIsDelay[a] ? (float)(size - 4) * 1000.0f / (v[CV_SRATE] > 0 ? v[CV_SRATE] : 48000.0f) : (float)size); break; }
        if (in.op == OP_DW) { float x = st[sp - 1]; if (buf) { buf[p->dpos[a]] = x; if (++p->dpos[a] >= size) p->dpos[a] = 0; } break; }
        if (in.op == OP_DR) {
          float ms = st[sp - 1], d = ms * v[CV_SRATE] * 0.001f; if (!(d >= 0)) d = 0; if (d > (float)(size - 3)) d = (float)(size - 3);
          int di = (int)d; float fr = d - (float)di; int i0 = p->dpos[a] - 1 - di; while (i0 < 0) i0 += size; int i1 = i0 - 1; if (i1 < 0) i1 += size;
          st[sp - 1] = buf ? buf[i0] + (buf[i1] - buf[i0]) * fr : 0; break;
        }
        if (in.op == OP_AL) {
          float fi = st[sp - 1]; int i = fi == fi ? (int)cm_floor(fi) : 0; i %= size; if (i < 0) i += size;
          st[sp - 1] = buf ? buf[i] : 0; break;
        }
        /* OP_AS: [index, value] -> value */
        { float val = st[--sp], fi = st[sp - 1]; int i = fi == fi ? (int)cm_floor(fi) : 0; i %= size; if (i < 0) i += size; if (buf) buf[i] = val; st[sp - 1] = val; }
        break;
      }
      case OP_LOOPI: { float n = st[--sp]; if (!(n > 0)) n = 0; if (n > CM_LOOP_MAX) n = CM_LOOP_MAX; v[in.a] = (float)(int)n; break; }
      case OP_LOOPC: if (v[in.a] <= 0) pc = in.b; else v[in.a] -= 1; break;
      case OP_END: return 0;
      default: return 1;
    }
  }
#undef PUSH
}

/* the editor's check: compile into a scratch machine with no knobs */
int cmfx_check_code(const char *code, int len, char *err, int errLen) {
  static CCode scratch; scratch.nOps = 0; scratch.nVars = 0; scratch.nProgs = 0; scratch.nParams = 0;
  if (err && errLen) err[0] = 0;
  return code_compile(&scratch, code, len, 48000, err, errLen) < 0 ? -1 : 0;
}
