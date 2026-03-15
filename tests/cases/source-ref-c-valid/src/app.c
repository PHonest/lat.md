#include "app.h"
#include <stdio.h>

void greet(const char *name) {
    printf("Hello, %s!\n", name);
}

void greeter_greet(struct Greeter *g, const char *name) {
    printf("%s %s!\n", g->prefix, name);
}

const char *DEFAULT_NAME = "World";
