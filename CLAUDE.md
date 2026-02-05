# Synergy.computer Project Instructions

## Deployment

**Hosting**: Cloudflare, syncing with Connect on studio exe.

**Deploy via SCP**:
```bash
scp index.html synergy.exe.xyz:/tmp/ && ssh synergy.exe.xyz "sudo cp /tmp/index.html /var/www/html/"
```

Key distinction: `ssh exe.dev` is the orchestrator CLI (manage VMs), while `ssh synergy.exe.xyz` is the actual VM (file operations).

## Domains
- `synergy.computer` (production)
