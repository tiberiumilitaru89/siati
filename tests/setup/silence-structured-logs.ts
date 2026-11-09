/**
 * `writeStructuredLog` scrie JSON pe stdout/stderr. În teste acest zgomot ascunde rezultatele reale,
 * așa că înghițim doar liniile de log structurat (cele care încep cu `{"timestamp"`).
 */
type WriteFn = typeof process.stdout.write;

function silenceStructuredLogs(stream: NodeJS.WriteStream): void {
  const original: WriteFn = stream.write.bind(stream);
  const filtered = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string' && chunk.startsWith('{"timestamp"')) {
      return true;
    }
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as WriteFn;
  stream.write = filtered;
}

silenceStructuredLogs(process.stdout);
silenceStructuredLogs(process.stderr);
