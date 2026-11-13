using Microsoft.Extensions.Logging;

namespace SequenceDojo;

internal sealed class DiagnosticLoggerProvider(DiagnosticLog? diagnostics = null) : ILoggerProvider
{
    private readonly DiagnosticLog _diagnostics = diagnostics ?? DiagnosticLog.Shared;
    public ILogger CreateLogger(string categoryName) => new FileLogger(_diagnostics, categoryName);
    public void Dispose() { }

    private sealed class FileLogger(DiagnosticLog diagnostics, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information && logLevel != LogLevel.None;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            try { diagnostics.Write($"{logLevel} {category}: {formatter(state, exception)}", exception); }
            catch (Exception error) { diagnostics.Write($"{logLevel} {category}: ログ書式の生成に失敗", error); }
        }
    }
}
