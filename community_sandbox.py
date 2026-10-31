"""Central Pedal (and Linux computers) - running a community plugin walled off (10.1).

Community plugins (Settings → Packages → Community, from Make & sell) are checked and reviewed by Motion Audio, but they
are still someone else's program. They never load inside the pedal driver or the live chain's own process: a community
plugin is hosted in its own process, started through command() below, which wraps the host in bubblewrap:
  * no network (--unshare-all: its own network, IPC, PID, UTS and cgroup namespaces, and a user namespace with no
    capabilities - --cap-drop ALL);
  * a read-only system (/usr, /lib, /etc pieces the loader needs), the plugin's own folder read-only at /plugin, an
    empty /tmp and HOME, a minimal /dev and its own /proc - it can't see the musician's files, the driver's data or
    other processes;
  * the PipeWire socket is the only thing shared in (so the plugin can pass audio), and only when asked for;
  * it dies with the driver (--die-with-parent) and can't take over the terminal (--new-session);
  * a seccomp filter (when the python3-seccomp package is there - it is on the Central Pedal image) refuses
    ptrace, mount, kernel modules, bpf, keyrings, namespaces, perf and opening internet / netlink / raw sockets.
What is NOT done yet (see docs/COMMUNITY-PLUGINS.md): the live chain doesn't route audio through such a process yet, so
community plugins installed on the Central Pedal are kept and can be scanned walled off, but aren't played live.
"""
import os
import shutil
import subprocess
import tempfile

# system folders the plugin's loader needs, read-only (missing ones are skipped: --ro-bind-try)
RO_SYSTEM = ("/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d",
             "/etc/alternatives", "/etc/fonts", "/usr/share/fonts")
# system calls refused (EPERM) inside the wall
DENY_SYSCALLS = ("ptrace", "process_vm_readv", "process_vm_writev", "mount", "umount2", "pivot_root", "chroot", "swapon", "swapoff",
                 "reboot", "kexec_load", "kexec_file_load", "init_module", "finit_module", "delete_module", "bpf", "perf_event_open",
                 "keyctl", "add_key", "request_key", "unshare", "setns", "personality", "userfaultfd", "acct", "quotactl",
                 "open_by_handle_at", "name_to_handle_at", "iopl", "ioperm", "settimeofday", "clock_settime")
# socket families refused: only local (AF_UNIX = 1, for the PipeWire socket) is left
DENY_FAMILIES = {"AF_INET": 2, "AF_INET6": 10, "AF_NETLINK": 16, "AF_PACKET": 17, "AF_BLUETOOTH": 31}


def available():
    """bubblewrap is there (the Central Pedal image has it; on a Linux computer: apt install bubblewrap)."""
    return shutil.which("bwrap") is not None


def seccomp_filter_fd():
    """A compiled seccomp filter in a temporary file, opened for bwrap's --seccomp; None without python3-seccomp."""
    try:
        import seccomp  # python3-seccomp (libseccomp's bindings)
    except ImportError:
        return None
    import errno
    f = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
    for name in DENY_SYSCALLS:
        try:
            f.add_rule(seccomp.ERRNO(errno.EPERM), name)
        except (RuntimeError, ValueError, OSError):
            pass   # (a call this kernel / architecture doesn't have)
    for fam in DENY_FAMILIES.values():
        f.add_rule(seccomp.ERRNO(errno.EAFNOSUPPORT), "socket", seccomp.Arg(0, seccomp.EQ, fam))
    tmp = tempfile.TemporaryFile()
    f.export_bpf(tmp)
    tmp.seek(0)
    return tmp


def command(plugin_dir, host_cmd, pipewire=False, runtime_dir=None, seccomp_fd=None):
    """The bwrap command line that runs host_cmd (a list, e.g. ["jalv", "-i", "urn:..."]) with only plugin_dir (read-only,
    at /plugin) and, when pipewire, the PipeWire socket. seccomp_fd: an open file's descriptor number for --seccomp."""
    if not host_cmd:
        raise ValueError("no plugin host to run")
    real = os.path.realpath(plugin_dir)
    if not os.path.isdir(real):
        raise ValueError("the plugin's folder isn't there")
    cmd = ["bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv"]
    for p in RO_SYSTEM:
        cmd += ["--ro-bind-try", p, p]
    cmd += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", "/tmp/home", "--ro-bind", real, "/plugin",
            "--setenv", "HOME", "/tmp/home", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LV2_PATH", "/plugin",
            "--setenv", "VST3_PATH", "/plugin", "--setenv", "CLAP_PATH", "/plugin", "--chdir", "/tmp"]
    if pipewire:
        rt = runtime_dir or os.environ.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid()
        cmd += ["--dir", "/tmp/run", "--ro-bind-try", os.path.join(rt, "pipewire-0"), "/tmp/run/pipewire-0", "--setenv", "XDG_RUNTIME_DIR", "/tmp/run"]
    if seccomp_fd is not None:
        cmd += ["--seccomp", str(int(seccomp_fd))]
    return cmd + ["--"] + list(host_cmd)


def start(plugin_dir, host_cmd, pipewire=True, **popen):
    """Starts host_cmd walled off; returns the Popen. Refuses to run a community plugin unwalled."""
    if not available():
        raise RuntimeError("bubblewrap isn't installed, so community plugins can't run walled off here")
    filt = seccomp_filter_fd()
    fds = (filt.fileno(),) if filt else ()
    try:
        return subprocess.Popen(command(plugin_dir, host_cmd, pipewire=pipewire, seccomp_fd=fds[0] if fds else None), pass_fds=fds, **popen)
    finally:
        if filt:
            filt.close()
