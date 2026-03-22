#ifndef APP_H
#define APP_H

struct Greeter {
    char *prefix;
};

enum Color { RED, GREEN, BLUE };

typedef int ErrorCode;

/* pointer typedef — declarator is pointer_declarator wrapping type_identifier */
typedef struct __Ctx *AppCtx;

#define MAX_SIZE 100
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))

#ifdef __cplusplus
extern "C" {
#endif

void greet(const char *name);

#if defined(APP_EXTRAS)
void extra_func(void);
#else
void fallback_func(void);
#endif

#ifdef __cplusplus
}
#endif

#endif
