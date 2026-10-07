// WebKit (macOS) ne sait pas encore itérer un ReadableStream avec `for await`, que pdfjs 6 utilise.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype.values ??= async function* values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      if (!preventCancel) reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;
}
