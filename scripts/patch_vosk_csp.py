"""Reproducible CSP compatibility patch for the pinned Vosk browser runtime."""
from pathlib import Path
import base64
import hashlib
import re

UPSTREAM_SHA256 = '29504515526e974f4cb053cf08811c4de5fb2a74007c0a5a957db50eaa8d5d0c'
BINDINGS = Path(__file__).parent / 'voice-patches/vosk-csp-bindings.js'
END_MARKERS = {
    'createNamedFunction': 'var emval_free_list=',
    'craftInvokerFunction': 'function heap32VectorToArray(',
    '__emval_get_method_caller': 'function __emval_incref(',
}


def patch_vosk(data):
    if hashlib.sha256(data).hexdigest() != UPSTREAM_SHA256:
        raise ValueError('Unexpected Vosk runtime: refusing to patch an unverified version')
    source = data.decode('utf-8')
    matches = list(re.finditer(r"var WorkerFactory = createBase64WorkerFactory\('([^']+)'", source))
    if len(matches) != 1:
        raise ValueError('Expected exactly one embedded Vosk worker')
    match = matches[0]
    worker = base64.b64decode(match[1], validate=True).decode('utf-8')
    bindings = BINDINGS.read_text()
    functions = list(re.finditer(r'^function (\w+)\(', bindings, re.MULTILINE))
    if {fn[1] for fn in functions} != set(END_MARKERS):
        raise ValueError('Unexpected CSP binding replacements')
    for index, fn in enumerate(functions):
        replacement = bindings[fn.start():functions[index + 1].start() if index + 1 < len(functions) else len(bindings)].strip()
        start_marker = 'function ' + fn[1] + '('
        end_marker = END_MARKERS[fn[1]]
        if worker.count(start_marker) != 1 or worker.count(end_marker) != 1:
            raise ValueError('Unexpected Vosk binding layout: ' + fn[1])
        start, end = worker.index(start_marker), worker.index(end_marker)
        worker = worker[:start] + replacement + '\n' + worker[end:]
    if re.search(r'\bnew\s+Function\b|\bnew_\(Function|\beval\s*\(', worker):
        raise ValueError('Dynamic JavaScript compilation remains in the worker')
    encoded = base64.b64encode(worker.encode('utf-8')).decode('ascii')
    notice = '// Modified by th.ink: CSP-compatible closure bindings; see scripts/voice-patches/vosk-csp-bindings.js.\n'
    # Canonical LF bytes keep the pinned hash stable when hosting upload tools
    # normalize text line endings. The upstream runtime contains mixed CRLF/LF.
    return (notice + source[:match.start(1)] + encoded + source[match.end(1):]).replace('\r\n', '\n').encode('utf-8')
