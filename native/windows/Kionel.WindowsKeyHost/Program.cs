using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kionel.WindowsKeyHost;

public static class Program
{
    private const int MaxInputBytes = 2 * 1024 * 1024;
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        MaxDepth = 12,
    };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length != 1) throw new HostException("usage", "exactly one operation is required");
            object? result = args[0] switch
            {
                "capabilities" => KeyHost.Capabilities(),
                "provision" => KeyHost.Provision(await ReadRequest<ProvisionRequest>()),
                "load" => KeyHost.Load(await ReadRequest<KeyRequest>()),
                "sign" => KeyHost.Sign(await ReadRequest<SignRequest>()),
                "remove" => KeyHost.Remove(await ReadRequest<RemoveRequest>()),
                _ => throw new HostException("unknown-operation", "operation is not supported"),
            };
            Console.Out.Write(JsonSerializer.Serialize(result, JsonOptions));
            return 0;
        }
        catch (Exception error)
        {
            var safe = error as HostException;
            Console.Error.Write(JsonSerializer.Serialize(new ErrorResponse(
                safe?.Code ?? "native-failure",
                safe?.Message ?? "Windows key operation failed closed"
            ), JsonOptions));
            return safe?.ExitCode ?? 2;
        }
    }

    private static async Task<T> ReadRequest<T>()
    {
        await using Stream input = Console.OpenStandardInput();
        using var data = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            int read = await input.ReadAsync(buffer);
            if (read == 0) break;
            if (data.Length + read > MaxInputBytes) throw new HostException("input-too-large", "request exceeds the 2 MiB limit");
            data.Write(buffer, 0, read);
        }
        if (data.Length == 0) throw new HostException("invalid-request", "JSON request body is required");
        try
        {
            return JsonSerializer.Deserialize<T>(data.ToArray(), JsonOptions)
                ?? throw new HostException("invalid-request", "JSON request body is empty");
        }
        catch (JsonException)
        {
            throw new HostException("invalid-request", "JSON request does not match the closed schema");
        }
    }
}

public sealed class HostException : Exception
{
    public string Code { get; }
    public int ExitCode { get; }

    public HostException(string code, string message, int exitCode = 2) : base(message)
    {
        Code = code;
        ExitCode = exitCode;
    }
}

public sealed record ErrorResponse(string Code, string Message);
