"""Reusable SSH helper for the Illume VPS. Handles Windows console encoding safely.

Usage:
  python .ssh-helper.py "command here"
  python .ssh-helper.py --node "<js code>"     # runs node script in project dir
  python .ssh-helper.py --sql "<sql>"          # runs psql query
"""
import sys, paramiko

HOST, USER, PASS = "187.124.112.151", "root", "Wind0wsazure@1234"
APP = "/var/www/illume-crm"


def out(s):
    """Print safely regardless of Windows console codepage."""
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode())


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=15)
    return c


def run(ssh, cmd, timeout=300):
    _, so, se = ssh.exec_command(cmd, timeout=timeout)
    o = so.read().decode("utf-8", "replace").strip()
    e = se.read().decode("utf-8", "replace").strip()
    code = so.channel.recv_exit_status()
    if o:
        out(o)
    if e and code != 0:
        out("STDERR: " + e[-1500:])
    return o, e, code


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    ssh = connect()
    try:
        if args[0] == "--node":
            code = args[1]
            run(ssh, f"cat > {APP}/_tmp.js << 'JSEOF'\n{code}\nJSEOF", 15)
            run(ssh, f"cd {APP} && node _tmp.js 2>&1; rm -f _tmp.js", 120)
        elif args[0] == "--sql":
            sql = args[1].replace('"', '\\"')
            run(ssh, f"PGPASSWORD='Illume_DB_Pr0d_2026!' psql -U illume_user -h localhost -d illume_crm -c \"{sql}\"", 60)
        else:
            for cmd in args:
                out(f"\n>>> {cmd}")
                run(ssh, cmd, 600)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
