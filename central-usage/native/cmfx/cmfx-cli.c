/* cmfx-cli - Central FX on the command line (the tests; also handy for checking a plugin by hand).
 *   cmfx-cli check <plugin.cmfx.json>                        prints {"ok":true,"name",...} or {"ok":false,"error"}
 *   cmfx-cli code <file>                                     checks code text: {"ok":true} or {"ok":false,"error"}
 *   cmfx-cli render <plugin> <rate> <in.f32> <out.f32> [block] [id=value ...]
 *       in/out: stereo float32, interleaved (L R L R ...); block: how many samples per call (default 128) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "cmfx.h"

static char *slurp(const char *path, long *len) {
  FILE *f = fopen(path, "rb"); if (!f) return NULL;
  fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  char *b = (char *)malloc((size_t)n + 1); if (!b) { fclose(f); return NULL; }
  if (fread(b, 1, (size_t)n, f) != (size_t)n) { fclose(f); free(b); return NULL; }
  fclose(f); b[n] = 0; *len = n; return b;
}
static void jstr(const char *s) { putchar('"'); for (; s && *s; s++) { if (*s == '"' || *s == '\\') putchar('\\'); if ((unsigned char)*s < 0x20) printf("\\u%04x", *s); else putchar(*s); } putchar('"'); }

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: cmfx-cli check|code|render ...\n"); return 2; }
  long len = 0; char *text = slurp(argv[2], &len);
  if (!text) { fprintf(stderr, "can't read %s\n", argv[2]); return 2; }
  char err[400];
  if (!strcmp(argv[1], "code")) {
    int r = cmfx_check_code(text, (int)len, err, sizeof err);
    if (r) { printf("{\"ok\":false,\"error\":"); jstr(err); printf("}\n"); } else printf("{\"ok\":true}\n");
    return 0;
  }
  float sr = argc > 3 && !strcmp(argv[1], "render") ? (float)atof(argv[3]) : 48000;
  CmFx *fx = (CmFx *)malloc(cmfx_struct_size());
  if (cmfx_load(fx, text, (int)len, sr, err, sizeof err) != 0) { printf("{\"ok\":false,\"error\":"); jstr(err); printf("}\n"); return !strcmp(argv[1], "check") ? 0 : 1; }
  float *pool = (float *)calloc(cmfx_pool_floats(fx), sizeof(float)); cmfx_attach(fx, pool);
  if (!strcmp(argv[1], "check")) {
    printf("{\"ok\":true,\"name\":"); jstr(cmfx_name(fx)); printf(",\"pool\":%lu,\"params\":[", cmfx_pool_floats(fx));
    for (int i = 0; i < cmfx_param_count(fx); i++) { printf("%s{\"id\":", i ? "," : ""); jstr(cmfx_param_id(fx, i)); printf(",\"min\":%g,\"max\":%g,\"default\":%g}", cmfx_param_min(fx, i), cmfx_param_max(fx, i), cmfx_param_default(fx, i)); }
    printf("]}\n"); return 0;
  }
  if (!strcmp(argv[1], "render") && argc >= 6) {
    long ilen = 0; char *in = slurp(argv[4], &ilen); if (!in) { fprintf(stderr, "can't read %s\n", argv[4]); return 2; }
    int block = argc > 6 ? atoi(argv[6]) : 128; if (block < 1) block = 128;
    for (int a = 7; a < argc; a++) { char *eq = strchr(argv[a], '='); if (!eq) continue; *eq = 0; int i = cmfx_param_index(fx, argv[a]); if (i >= 0) cmfx_set_param(fx, i, (float)atof(eq + 1)); }
    /* knobs set before the start apply at once (no glide from the default) */
    cmfx_reset(fx);
    long frames = ilen / 8; const float *src = (const float *)in; float *out = (float *)malloc((size_t)frames * 8 + 8);
    float *l = (float *)malloc(sizeof(float) * (size_t)block), *r = (float *)malloc(sizeof(float) * (size_t)block), *ol = (float *)malloc(sizeof(float) * (size_t)block), *orr = (float *)malloc(sizeof(float) * (size_t)block);
    clock_t c0 = clock();
    for (long off = 0; off < frames; off += block) {
      int n = (int)(frames - off < block ? frames - off : block);
      for (int i = 0; i < n; i++) { l[i] = src[2 * (off + i)]; r[i] = src[2 * (off + i) + 1]; }
      cmfx_process(fx, l, r, ol, orr, n);
      for (int i = 0; i < n; i++) { out[2 * (off + i)] = ol[i]; out[2 * (off + i) + 1] = orr[i]; }
    }
    if (getenv("CMFX_TIME")) fprintf(stderr, "cpu: %.3f ms for %.3f s of sound\n", (double)(clock() - c0) * 1000.0 / CLOCKS_PER_SEC, frames / sr);
    FILE *f = fopen(argv[5], "wb"); if (!f) return 2; fwrite(out, 8, (size_t)frames, f); fclose(f);
    const char *st = cmfx_status(fx); if (st) fprintf(stderr, "status: %s\n", st);
    return 0;
  }
  fprintf(stderr, "usage: cmfx-cli check|code|render ...\n"); return 2;
}
