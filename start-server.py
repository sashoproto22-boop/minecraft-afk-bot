import os
import sys
import time
import socket
from python_aternos import Client

# Get credentials from GitHub Secrets
ATERNOS_USER = os.environ.get('ATERNOS_USER')
ATERNOS_PASS = os.environ.get('ATERNOS_PASS')
SERVER_HOST = os.environ.get('SERVER_HOST')
SERVER_PORT = int(os.environ.get('SERVER_PORT', 25565))

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def is_server_online(host, port, timeout=5):
    """Quick check if server is reachable"""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except:
        return False

def main():
    # First, check if server is already online
    log(f"Checking if {SERVER_HOST}:{SERVER_PORT} is online...")
    if is_server_online(SERVER_HOST, SERVER_PORT):
        log("✅ Server is already online! Nothing to do.")
        return

    log("❌ Server appears offline. Attempting to start...")

    # Login to Aternos
    try:
        log("🔐 Logging into Aternos...")
        client = Client()
        client.login(ATERNOS_USER, ATERNOS_PASS)
        log("✅ Logged in!")
    except Exception as e:
        log(f"❌ Login failed: {e}")
        sys.exit(1)

    # Get servers
    servers = client.list_servers()
    if not servers:
        log("❌ No servers found on this account!")
        sys.exit(1)

    log(f"Found {len(servers)} server(s)")

    # Find OUR server by matching the address
    target_server = None
    for srv in servers:
        if SERVER_HOST.lower() in srv.address.lower():
            target_server = srv
            break

    if not target_server:
        log(f"❌ Could not find server matching {SERVER_HOST}")
        # Just use the first one as fallback
        target_server = servers[0]
        log(f"Using first server: {target_server.address}")

    log(f"Server status: {target_server.status}")

    # Start it!
    if target_server.status in ['offline', 'crashed']:
        try:
            log("🚀 Starting server...")
            target_server.start()
            log("✅ Start command sent!")
        except Exception as e:
            log(f"❌ Start failed: {e}")
            sys.exit(1)
    elif target_server.status == 'queueing':
        log("⏳ Server already in queue, waiting...")
    elif target_server.status in ['online', 'starting']:
        log("✅ Server is already starting/online")
        return

    # Wait for server to come online (max 10 minutes)
    log("⏳ Waiting for server to come online...")
    max_wait = 600  # 10 minutes
    waited = 0
    while waited < max_wait:
        time.sleep(15)
        waited += 15
        target_server.fetch()  # Refresh status
        log(f"  Status: {target_server.status} ({waited}s elapsed)")

        if target_server.status == 'online':
            log("✅ SERVER IS ONLINE!")
            return

        if target_server.status in ['offline', 'crashed']:
            log("❌ Server failed to start")
            sys.exit(1)

    log("⏱️ Timed out waiting for server")
    sys.exit(1)

if __name__ == '__main__':
    main()
