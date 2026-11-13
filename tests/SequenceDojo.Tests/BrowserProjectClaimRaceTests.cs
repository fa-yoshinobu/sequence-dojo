namespace SequenceDojo.Tests;

public class BrowserProjectClaimRaceTests
{
    [Fact]
    public async Task CandidateReleasedBeforeClaimCannotOwnOrBlockThePendingRequest()
    {
        string folder = Directory.CreateTempSubdirectory("dojo-claim-race-").FullName;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var opens = new BrowserProjectOpens();
        Task? pending = null;
        try
        {
            string path = Path.Combine(folder, "fixture.sdojo");
            File.WriteAllText(path, "{}");
            pending = opens.OpenAsync(path, timeout.Token);
            opens.Register("stale-candidate");
            // SendPendingProject may already hold this candidate when its socket's finally runs.
            opens.Release("stale-candidate");
            Assert.Null(opens.Claim("stale-candidate"));
            for (int i = 0; i < 50; i++)
            {
                string client = "racing-" + i;
                opens.Register(client);
                await Task.WhenAll(Task.Run(() => opens.Claim(client)), Task.Run(() => opens.Release(client)));
                Assert.Null(opens.Claim(client));
            }
            opens.Register("reconnected");
            var delivered = Assert.IsType<CoreProjectPayload>(opens.Claim("reconnected"));
            Assert.False(opens.Complete("stale-candidate", delivered.RequestId));
            Assert.True(opens.Complete("reconnected", delivered.RequestId));
            await pending;
        }
        finally
        {
            timeout.Cancel();
            if (pending != null) { try { await pending; } catch (OperationCanceledException) { } }
            string full = Path.GetFullPath(folder);
            Assert.Equal(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())), Path.GetDirectoryName(full), ignoreCase: true);
            Assert.StartsWith("dojo-claim-race-", Path.GetFileName(full));
            Directory.Delete(full, recursive: true);
        }
    }
}
