/* sha256.h - a file's SHA-256: a community plugin's program files are checked against what Motion Audio reviewed
 * every time it starts (not only when it was installed) */
#ifndef CM_SHA256_H
#define CM_SHA256_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
void cm_sha256(const uint8_t *data, size_t n, uint8_t out[32]);
int cm_sha256_file(const char *path, char hex[65]);   /* 1 when the file was read */
#ifdef __cplusplus
}
#endif
#endif
