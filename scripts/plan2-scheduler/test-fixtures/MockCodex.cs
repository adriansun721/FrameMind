// Deterministic native CLI fixture. No AI calls or PLAN business implementation.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

public class Plan2MockCodex {
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    static Dictionary<string, object> Obj(object value) { return (Dictionary<string, object>) value; }
    static object[] Arr(object value) { return (object[]) value; }
    static Dictionary<string, object> Map(params object[] pairs) {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) result[(string)pairs[i]] = pairs[i + 1];
        return result;
    }
    static string Sha(string path) {
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant();
    }
    static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); }
    static string Git(string arguments) {
        var info = new ProcessStartInfo("git.exe", arguments) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using (var p = Process.Start(info)) {
            var output = p.StandardOutput.ReadToEnd();
            var error = p.StandardError.ReadToEnd();
            p.WaitForExit();
            if (p.ExitCode != 0) throw new Exception("Fixture git failed: " + error);
            return output.Trim();
        }
    }
    public static int Main(string[] args) {
        try {
            Console.OutputEncoding = Utf8;
            var mode = Environment.GetEnvironmentVariable("PLAN2_SCHEDULER_TEST_MODE");
            if (args.Contains("--fixture-descendant") || mode == "no-input") {
                Emit(Map("type", "fixture.waiting"));
                while (true) System.Threading.Thread.Sleep(500);
            }
            var prompt = new StreamReader(Console.OpenStandardInput(), Utf8).ReadToEnd().TrimStart('\uFEFF');
            var root = Environment.CurrentDirectory;
            if (!args.Contains("exec") || !args.Contains("--json") || !args.Contains("--output-schema") || args.Last() != "-" || args.Contains("resume") || args.Contains("--last")) throw new Exception("Invalid CLI arguments");
            if (args[2] != root || args[6] != "approval_policy=\"never\"") throw new Exception("Native argv quoting failed");
            var state = Obj(Json.DeserializeObject(File.ReadAllText(Path.Combine(root, ".git", "plan2-scheduler", "state.json"), Utf8)));
            var task = Arr(state["tasks"]).Select(Obj).First(x => (string)x["status"] == "running");
            var attempt = Obj(Arr(task["attempts"]).Last());
            var id = (string)task["id"];
            var attemptId = (string)attempt["id"];
            if (!prompt.StartsWith("$implement") || !prompt.Contains(attemptId)) throw new Exception("Missing explicit skill invocation or attempt identity");
            var skillPath = Environment.GetEnvironmentVariable("PLAN2_SCHEDULER_TEST_SKILL");
            if (mode != "no-thread") Emit(Map("type", "thread.started", "thread_id", Guid.NewGuid().ToString()));
            Emit(Map("type", "item.completed", "item", Map("type", "command_execution", "status", "completed", "command", mode == "unread" ? "Write-Output implement" : "Get-Content -LiteralPath '" + skillPath + "' -Raw -Encoding UTF8", "exit_code", 0, "aggregated_output", mode == "unread" ? "I invoked implement" : File.ReadAllText(skillPath, Utf8))));
            if (mode == "fail") { Console.Error.WriteLine("Deterministic CLI failure"); return 23; }
            if (mode == "wait") { Emit(Map("type", "fixture.waiting")); while (true) System.Threading.Thread.Sleep(500); }
            if (mode == "inherited-output") {
                var descendant = Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--fixture-descendant") { UseShellExecute = false, CreateNoWindow = true });
                File.WriteAllText(Path.Combine(root, ".git", "descendant.pid"), descendant.Id.ToString());
                return 0;
            }
            var plan = File.ReadAllText(Path.Combine(root, "PLAN2.0.md"), Utf8);
            var detail = Regex.Match(plan, "^### " + id + " [^\\r\\n]+\\r?\\n.*?(?=^### T2-|^## 6\\.|\\z)", RegexOptions.Multiline | RegexOptions.Singleline).Value;
            int criteria = Regex.Matches(detail, @"^- \[ \] ", RegexOptions.Multiline).Count;
            var evidence = new List<Dictionary<string, object>>();
            foreach (var kind in new[] { "implementation", "verification", "review", "acceptance" }) {
                string relative = "docs/evidence/plan2/" + id + "/" + attemptId + "-" + kind + ".md";
                string path = Path.Combine(root, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, "Fixture " + kind + " for " + attemptId + ". Not business evidence.", Utf8);
                evidence.Add(Map("path", relative, "kind", kind, "sha256", Sha(path)));
            }
            Git("add -- docs/evidence/plan2");
            if (mode == "plan-change") { File.AppendAllText(Path.Combine(root, "PLAN2.0.md"), "\nChanged during worker"); Git("add -- PLAN2.0.md"); }
            Git("commit -m \"Fixture " + id + " " + attemptId + "\"");
            var acceptance = Enumerable.Range(1, criteria).Select(i => Map("index", i, "passed", true, "evidence", new[] { evidence[3]["path"] })).ToArray();
            var review = Map("passed", true, "openFindings", 0, "evidence", new[] { evidence[2]["path"] });
            var result = Map("schemaVersion", 1, "taskId", id, "attemptId", attemptId, "outcome", "complete", "summary", "Fixture " + id,
                "skill", Map("path", skillPath, "sha256", attempt["skillHash"]),
                "implementation", Map("passed", true, "evidence", new[] { evidence[0]["path"] }),
                "verification", Map("passed", true, "evidence", new[] { evidence[1]["path"] }),
                "review", review, "acceptance", acceptance, "humanRequired", mode == "human", "commit", Git("rev-parse HEAD"), "evidence", evidence, "handoff", evidence[0]["path"]);
            switch (mode) {
                case "missing": File.Delete(Path.Combine(root, (string)evidence[3]["path"])); break;
                case "hash": evidence[0]["sha256"] = new string('0', 64); break;
                case "acceptance": acceptance[0]["passed"] = false; break;
                case "review": review["openFindings"] = 1; break;
                case "no-commit": result["commit"] = task["baseCommit"]; break;
            }
            File.WriteAllText(Path.Combine((string)attempt["directory"], "result.json"), Json.Serialize(result), Utf8);
            Emit(Map("type", "turn.completed"));
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
