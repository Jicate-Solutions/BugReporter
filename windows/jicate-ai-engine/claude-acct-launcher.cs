// claude-acct-launcher.cs - a tiny claude-acct.exe for drains that execFile()
// CLAUDE_BIN without a shell. Node 18.20.2+/20.12.2+/22 refuse to start a .cmd
// that way (EINVAL), so a .cmd shim cannot stand in for claude.exe there; an
// .exe can. This only starts:  node.exe claude-acct.mjs <the same arguments>
//
// The arguments are passed on as the RAW command-line text after our own
// program name, so their quoting reaches node exactly as the drain wrote it.
// stdin / stdout / stderr are inherited (no copy here); the exit code is
// node's. No key, no network, nothing written.
//
// Build on the box (C# 5 compiler that ships with Windows / .NET Framework 4):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe /out:C:\jicate-ai\claude-acct.exe C:\jicate-ai\claude-acct-launcher.cs
// node.exe: CLAUDE_ACCT_NODE if set, else C:\Program Files\nodejs\node.exe.
// claude-acct.mjs: next to this .exe.
// UNTESTED on Windows as of 2026-11-11 (written on a Mac); install step 4 (ACCOUNTS.md) proves it.
using System;
using System.Diagnostics;
using System.IO;

static class ClaudeAcctLauncher
{
    static string ArgsAfterProgramName(string line)
    {
        int i = 0;
        while (i < line.Length && char.IsWhiteSpace(line[i])) i++;
        if (i < line.Length && line[i] == '"')
        {
            i++;
            while (i < line.Length && line[i] != '"') i++;
            if (i < line.Length) i++;
        }
        else
        {
            while (i < line.Length && !char.IsWhiteSpace(line[i])) i++;
        }
        return i < line.Length ? line.Substring(i).TrimStart() : "";
    }

    static int Main()
    {
        string node = Environment.GetEnvironmentVariable("CLAUDE_ACCT_NODE");
        if (string.IsNullOrEmpty(node)) node = @"C:\Program Files\nodejs\node.exe";
        string here = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(here, "claude-acct.mjs");
        string rest = ArgsAfterProgramName(Environment.CommandLine);

        var psi = new ProcessStartInfo(node, "\"" + script + "\"" + (rest.Length > 0 ? " " + rest : ""));
        psi.UseShellExecute = false; // inherit our stdin/stdout/stderr handles
        psi.CreateNoWindow = false;
        try
        {
            using (var p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("claude-acct.exe: cannot start " + node + ": " + e.Message);
            return 127;
        }
    }
}
