import paramiko, os
os.environ["PYTHONIOENCODING"] = "utf-8"
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("187.124.112.151", username="root", password="Wind0wsazure@1234", timeout=15)
print("Connected!\n")

stdin, stdout, stderr = ssh.exec_command("pm2 logs illume-crm --lines 80 --nostream 2>&1", timeout=15)
out = stdout.read().decode("utf-8", errors="replace").strip()
for line in out.split('\n'):
    try: print(line)
    except UnicodeEncodeError: print(line.encode('ascii','replace').decode())

ssh.close()
