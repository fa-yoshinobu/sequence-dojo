using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace SequenceDojo;

internal sealed class TaskFiles
{
    internal const int MaxBytes = 5 * 1024 * 1024;
    internal string DirectoryPath { get; }
    internal sealed record Item(string File, string Content);
    internal sealed record Listing(List<Item> Items, List<string> Errors);

    internal TaskFiles(string? directory = null)
    {
        string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        if (directory == null && string.IsNullOrWhiteSpace(documents))
            throw new IOException("ドキュメントフォルダーが見つかりません。");
        DirectoryPath = Path.GetFullPath(directory ?? Path.Combine(documents, "SequenceDojo", "tasks"));
    }

    internal async Task<Listing> ReadAllAsync(CancellationToken ct = default)
    {
        List<Item> items = []; List<string> errors = [];
        if (!Directory.Exists(DirectoryPath)) return new(items, errors);
        foreach (string path in Directory.EnumerateFiles(DirectoryPath, "*.json").Order(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                string content = await ReadBoundedAsync(file, ct);
                Validate(content);
                items.Add(new(Path.GetFileName(path), content));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or DecoderFallbackException)
            { errors.Add($"{Path.GetFileName(path)}: {ex.Message}"); }
        }
        return new(items, errors);
    }

    internal async Task<Item> ImportAsync(Stream content, CancellationToken ct = default)
    {
        string text = await ReadBoundedAsync(content, ct);
        Validate(text);
        Directory.CreateDirectory(DirectoryPath);
        string name = Guid.NewGuid().ToString("N") + ".json";
        using var file = new FileStream(Path.Combine(DirectoryPath, name), FileMode.CreateNew, FileAccess.Write, FileShare.None);
        await file.WriteAsync(Encoding.UTF8.GetBytes(text), ct);
        return new(name, text);
    }

    internal static async Task<string> ReadBoundedAsync(Stream input, CancellationToken ct = default)
    {
        using var bytes = new MemoryStream();
        byte[] buffer = new byte[8192];
        int length;
        while ((length = await input.ReadAsync(buffer, ct)) != 0)
        {
            if (bytes.Length + length > MaxBytes) throw new IOException("課題ファイルは5 MBまでです。");
            bytes.Write(buffer, 0, length);
        }
        return new UTF8Encoding(false, true).GetString(bytes.ToArray()).TrimStart('\uFEFF');
    }

    internal static void Validate(string text)
    {
        using var document = JsonDocument.Parse(text);
        var task = document.RootElement;
        if (task.ValueKind != JsonValueKind.Object || !task.TryGetProperty("title", out var title)
            || title.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(title.GetString()))
            throw new IOException("title: 課題名が必要です。");
        if (task.TryGetProperty("grade", out var grade) && !Integer(grade, 1, 3))
            throw new IOException("grade: 1〜3の整数にしてください。");
        if (task.TryGetProperty("description", out var description) && description.ValueKind != JsonValueKind.String)
            throw new IOException("description: 文字列にしてください。");
        if (!task.TryGetProperty("scenario", out var scenario) || scenario.ValueKind != JsonValueKind.Array || scenario.GetArrayLength() == 0)
            throw new IOException("scenario: 1手順以上の配列が必要です。");
        int index = 0;
        foreach (var step in scenario.EnumerateArray())
        {
            index++;
            if (!ValidStep(step)) throw new IOException($"行 {StepLine(text, index)}: scenario[{index - 1}]（手順{index}）: 命令・条件のキー、型、範囲を確認してください。");
        }
    }

    private static int StepLine(string text, int target)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(text);
        var reader = new Utf8JsonReader(bytes);
        bool scenario = false; int index = 0;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.PropertyName && reader.CurrentDepth == 1)
                scenario = reader.ValueTextEquals("scenario");
            if (scenario && reader.CurrentDepth == 2 && reader.TokenType is not (JsonTokenType.EndObject or JsonTokenType.EndArray or JsonTokenType.PropertyName))
            {
                if (++index == target) return Encoding.UTF8.GetString(bytes, 0, (int)reader.TokenStartIndex).Count(c => c == '\n') + 1;
            }
        }
        return 1;
    }

    private static readonly string[] Commands = ["reset", "press", "hold", "ss0", "ss1", "dsw", "work", "clearWorks", "wait", "note", "expect", "waitFor", "expectFor"];
    private static bool Integer(JsonElement value, int min, int max) => value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int n) && n >= min && n <= max;
    private static bool Boolean(JsonElement value) => value.ValueKind is JsonValueKind.True or JsonValueKind.False;
    private static bool TextIs(JsonElement value, params string[] options) => value.ValueKind == JsonValueKind.String && options.Contains(value.GetString());
    private static bool ValidStep(JsonElement step)
    {
        if (step.ValueKind != JsonValueKind.Object) return false;
        string[] commands = Commands.Where(c => step.TryGetProperty(c, out _)).ToArray();
        if (commands.Length != 1) return false;
        string command = commands[0]; var value = step.GetProperty(command);
        foreach (var property in step.EnumerateObject())
        {
            string name = property.Name;
            if (name == command) continue;
            if (name == "msg" && property.Value.ValueKind == JsonValueKind.String) continue;
            if (name == "ms" && (command is "press" or "expectFor") && Integer(property.Value, 1, int.MaxValue)) continue;
            if (name == "timeout" && command == "waitFor" && Integer(property.Value, 1, int.MaxValue)) continue;
            if (name == "on" && command == "hold" && Boolean(property.Value)) continue;
            return false;
        }
        return command switch
        {
            "reset" or "clearWorks" => value.ValueKind == JsonValueKind.True,
            "ss0" or "ss1" => Boolean(value),
            "press" => TextIs(value, "PB1", "PB2", "PB3", "PB4", "PB5"),
            "hold" => TextIs(value, "PB1", "PB2", "PB3", "PB4", "PB5") && step.TryGetProperty("on", out var on) && Boolean(on),
            "dsw" => Integer(value, 0, 9),
            "wait" => Integer(value, 1, int.MaxValue),
            "note" => value.ValueKind == JsonValueKind.String,
            "work" => value.ValueKind == JsonValueKind.Object && value.TryGetProperty("at", out var at) && TextIs(at, "left", "center", "right")
                && value.TryGetProperty("screws", out var screws) && screws.ValueKind == JsonValueKind.Array && screws.GetArrayLength() == 4
                && screws.EnumerateArray().All(v => Boolean(v) || Integer(v, 0, 1)),
            "expect" or "waitFor" => ValidConditions(value),
            "expectFor" => ValidConditions(value) && step.TryGetProperty("ms", out var ms) && Integer(ms, 1, int.MaxValue),
            _ => false
        };
    }

    private static bool ValidConditions(JsonElement conditions)
    {
        if (conditions.ValueKind != JsonValueKind.Object) return false;
        var entries = conditions.EnumerateObject().ToArray();
        return entries.Length > 0 && entries.All(p => p.Name switch
        {
            "PL1" or "PL2" or "PL3" or "PL4" or "RY1" or "RY2" or "LS1" or "LS2" or "LS3" or "LS4" or "LS5" => Boolean(p.Value),
            "DPL1" or "DPL2" => Integer(p.Value, -1, 9),
            "conveyor" => TextIs(p.Value, "left", "right", "stop"),
            _ => false
        });
    }

    internal static void MapEndpoints(WebApplication app, BrowserSession session, TaskFiles? storage = null)
    {
        app.MapGet("/api/tasks", async (HttpContext context) =>
        {
            bool allowed = session.Matches(context.Request.Cookies[BrowserSession.CookieName])
                && (context.Request.Headers.Origin.Count == 0 || session.Allows(context));
            if (!allowed) return Results.StatusCode(StatusCodes.Status403Forbidden);
            try { return Results.Json(await (storage ?? new TaskFiles()).ReadAllAsync(context.RequestAborted)); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { return Results.Problem(ex.Message); }
        });
        app.MapPost("/api/tasks", async (HttpContext context) =>
        {
            if (!session.Allows(context)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            if (context.Request.ContentLength > MaxBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            try { return Results.Json(await (storage ?? new TaskFiles()).ImportAsync(context.Request.Body, context.RequestAborted)); }
            catch (Exception ex) when (ex is IOException or JsonException or DecoderFallbackException)
            { return Results.BadRequest(new { error = ex.Message }); }
            catch (UnauthorizedAccessException ex) { return Results.Problem(ex.Message); }
        });
        app.MapPost("/api/tasks/open-folder", (HttpContext context) =>
        {
            if (!session.Allows(context)) return Results.StatusCode(StatusCodes.Status403Forbidden);
            try
            {
                var tasks = storage ?? new TaskFiles();
                Directory.CreateDirectory(tasks.DirectoryPath);
                var start = new ProcessStartInfo("explorer.exe") { UseShellExecute = true };
                start.ArgumentList.Add(StoragePath.ResolveExisting(tasks.DirectoryPath));
                Process.Start(start);
                return Results.Ok();
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
            { return Results.Problem(ex.Message); }
        });
    }
}
