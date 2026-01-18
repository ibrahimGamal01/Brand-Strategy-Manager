# Instagram Scraper Scripts

## Setup

Install Python dependencies:
```bash
cd apps/backend/scripts
pip3 install -r requirements.txt
```

## Usage

### Basic scraping:
```bash
python3 instagram_scraper.py ummahpreneur 30
```

### With proxy:
```bash
python3 instagram_scraper.py ummahpreneur 30 "http://proxy:port"
```

## Features

- ✅ Session persistence (better rate limits)
- ✅ Rotating user agents
- ✅ Built-in rate limiting
- ✅ Proxy support
- ✅ Automatic retries
- ✅ Media URL extraction

## Tor Integration (Optional)

For free IP rotation:

```bash
# Install Tor
brew install tor

# Start Tor
tor &

# Use with scraper
python3 instagram_scraper.py ummahpreneur 30 "socks5h://127.0.0.1:9050"
```
