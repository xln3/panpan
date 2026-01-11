# DatasetDownload Tool

Download large files (datasets, model weights) with safety checks and user consent.

## Overview

The DatasetDownload tool is designed for handling large file downloads that are common in ML workflows. It provides:

- Pre-flight checks (size, disk space, network)
- **Local resource validation** (disk space, existing files)
- User consent flow with clear information
- Multiple download methods (foreground, background, manual)
- Network error diagnosis with actionable hints
- Resume support for interrupted downloads

## Two-Phase Workflow

### Phase 1: Prepare

Call with `operation="prepare"` to run pre-flight checks:

```json
{
  "operation": "prepare",
  "url": "https://example.com/dataset.tar.gz",
  "destination": "/data/datasets/dataset.tar.gz"
}
```

#### Remote Checks
- **File size** and content type (via HTTP HEAD request)
- **Resume support** detection (checks Accept-Ranges header)
- **Network connectivity** with error diagnosis
- **Estimated download time** (assumes ~10 MB/s, notes uncertainty for large files)

#### Local Resource Checks
- **Available disk space** at destination path (via `df`)
- **Sufficiency validation** - requires file size + 10% buffer
- **Destination exists** check - warns if file will be overwritten
- **Parent directory resolution** - finds nearest existing parent if destination doesn't exist yet

If disk space is insufficient, the tool returns:
```
Disk Space:
  Available: 2.50 GB
  Sufficient: NO - WILL FILL DISK
  Destination exists: no

⚠️  INSUFFICIENT DISK SPACE - Do not proceed without freeing space!
```

Example output:
```
Download Preparation Results:
  URL: https://example.com/dataset.tar.gz
  Destination: /data/datasets/dataset.tar.gz

File Info:
  Size: 4.44 GB (4762707968 bytes)
  Type: application/gzip
  Resume supported: yes

Disk Space:
  Available: 35.23 GB
  Sufficient: YES
  Destination exists: no

Estimated time: 8 minutes (at ~10 MB/s, actual time depends on network)
```

### Phase 2: Inform User

Present the prepare results to the user:
- File size and estimated download time
- Disk space status (sufficient or not)
- Necessity level and explanation
- Available download methods

Get explicit consent before proceeding.

### Phase 3: Download

Call with `operation="download"` after user consent:

```json
{
  "operation": "download",
  "url": "https://example.com/dataset.tar.gz",
  "destination": "/data/datasets/dataset.tar.gz",
  "method": "tmux",
  "necessity": "required",
  "necessity_detail": "Training data for model reproduction"
}
```

## Download Methods

| Method | Description | Use When |
|--------|-------------|----------|
| `foreground` | Blocking with streaming progress | Small files, need to monitor |
| `nohup` | Background with log file | Want to disconnect terminal |
| `tmux` | Detached tmux session | Want to attach/monitor later |
| `screen` | Detached screen session | Prefer screen over tmux |
| `manual` | Returns wget command | User wants full control |

### Foreground

Streams download progress to terminal. Blocking operation with 4-hour timeout.

### nohup

Starts download in background using `nohup`. Returns:
- Process ID (PID)
- Log file location (`{destination}.download.log`)
- Commands to monitor/stop

```
To check/monitor:
tail -f "/data/dataset.tar.gz.download.log"  # Monitor progress
ps -p 12345  # Check if running
kill 12345  # Stop download
```

### tmux

Creates detached tmux session. Returns:
- Session name
- Commands to attach/kill

```
To check/monitor:
tmux attach -t panpan-download  # Attach to monitor (Ctrl+B D to detach)
tmux kill-session -t panpan-download  # Stop download
```

### screen

Creates detached screen session. Returns:
- Session name
- Commands to attach/kill

```
To check/monitor:
screen -r panpan-download  # Attach to monitor (Ctrl+A D to detach)
screen -X -S panpan-download quit  # Stop download
```

### manual

Returns the wget command for user to run themselves:

```
Run this command to download:

  wget -c --progress=dot:giga -O "/data/dataset.tar.gz" "https://example.com/dataset.tar.gz"

To run in background:
  nohup wget -c --progress=dot:giga -O "/data/dataset.tar.gz" "https://example.com/dataset.tar.gz" > download.log 2>&1 &

To monitor progress:
  tail -f download.log
```

## Necessity Levels

Specify why the download is needed:

| Level | Description | Example |
|-------|-------------|---------|
| `required` | Won't work without it | Training dataset |
| `recommended` | Needed for full functionality | Pretrained weights |
| `optional` | Nice to have, not strictly needed | Evaluation dataset |

Use `necessity_detail` for additional context explaining why the file is needed.

## Network Error Handling

When network errors occur during prepare, the tool provides specific troubleshooting hints:

### Timeout
```
The connection timed out. Possible causes:
  • Server is slow or overloaded
  • Network firewall blocking the connection
  • You may need a proxy to access this host

Try:
  • Check if you can reach example.com in a browser
  • Set proxy: export https_proxy=http://your-proxy:port
  • Use a VPN if the host is geo-restricted
  • Try a mirror if available (search: "example.com mirror")
```

### Connection Refused / Reset
```
Connection was reset or broken.

Possible causes:
  • Server closed the connection unexpectedly
  • Network instability
  • Firewall or proxy terminating the connection

Try:
  • Retry the download - this may be transient
  • Check if a proxy is required for this host
  • Try downloading at a different time (server may be overloaded)
```

### DNS Errors
```
DNS lookup failed for example.com

Try:
  • Check your internet connection
  • Try a different DNS server: export DNS_SERVER=8.8.8.8
  • Verify the hostname is correct: nslookup example.com
  • Add to /etc/hosts if you know the IP address
```

### SSL/TLS Errors
```
SSL/TLS connection failed.

Possible causes:
  • Certificate verification failed (self-signed or expired cert)
  • TLS version mismatch
  • Proxy intercepting HTTPS traffic

Try:
  • If using a corporate proxy, ensure its CA cert is installed
  • For testing only: wget --no-check-certificate (not recommended)
```

### HTTP Errors

| Code | Hints |
|------|-------|
| 403 | Check authentication, try VPN, search for alternative sources |
| 404 | Verify URL, file may have moved or been deleted |
| 5xx | Server error, retry later, check status page, try mirror |

## Resume Support

The tool handles resume intelligently:

1. **Detection**: Checks `Accept-Ranges: bytes` header during prepare
2. **Smart usage**: Only uses `wget -c` when:
   - Resume is requested (`resume: true`, the default)
   - Destination file already exists (partial download)
3. **Safety**: Avoids `-c` flag when file doesn't exist (unnecessary) or when server doesn't support ranges (would corrupt file)

## Input Schema

### Prepare Operation

```typescript
{
  operation: "prepare",
  url: string,        // URL to download (must be valid URL)
  destination: string // Local path for the downloaded file
}
```

### Download Operation

```typescript
{
  operation: "download",
  url: string,              // URL to download
  destination: string,      // Local path for the downloaded file
  method: "foreground" | "nohup" | "tmux" | "screen" | "manual",
  necessity: "required" | "recommended" | "optional",
  necessity_detail?: string, // Additional explanation
  session_name?: string,     // Custom session name for tmux/screen (default: "panpan-download")
  resume?: boolean           // Enable resume for partial downloads (default: true)
}
```

## Best Practices

1. **Always run prepare first** - Never download without checking size and disk space
2. **Inform the user** - Present all relevant information before downloading
3. **Get explicit consent** - Let the user choose the download method
4. **Use appropriate method**:
   - `foreground` for files < 1GB or when you need to monitor
   - `nohup`/`tmux`/`screen` for large files that take hours
   - `manual` when user wants to customize the command
5. **Handle errors gracefully** - Present troubleshooting hints to user
6. **Check necessity** - Don't download optional files without asking
