/* UTF-8 byte search. The worker normalizes Unicode before indexing.
   No libc, allocation, imports, or shared memory required. */
__attribute__((export_name("contains")))
int contains(const unsigned char *text, unsigned int length,
             const unsigned char *query, unsigned int size) {
    if (!size) return 1;
    if (size > length) return 0;
    unsigned int skip[256];
    for (unsigned int i = 0; i < 256; i++) skip[i] = size;
    for (unsigned int i = 0; i + 1 < size; i++) skip[query[i]] = size - 1 - i;
    unsigned int pos = 0;
    while (pos <= length - size) {
        unsigned int j = size;
        while (j && text[pos + j - 1] == query[j - 1]) j--;
        if (!j) return 1;
        pos += skip[text[pos + size - 1]];
    }
    return 0;
}
