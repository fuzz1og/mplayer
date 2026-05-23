import urllib.request, re

headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/"}

# Check page 2 of artist category
pages = [
    "https://music.163.com/discover/artist/cat?id=1002",
    "https://music.163.com/discover/artist/cat?id=1002&offset=100",
    "https://music.163.com/discover/artist/cat?id=1002&offset=0&page=2",
    "https://music.163.com/discover/artist/cat?id=1002&page=2",
    "https://music.163.com/discover/artist/cat?id=1002&initial=-1",
]

for url in pages:
    try:
        req = urllib.request.Request(url, headers=headers)
        raw = urllib.request.urlopen(req, timeout=10).read()
        html = raw.decode("utf-8", errors="replace")
        # Count artist items
        sml_count = len(re.findall(r'class="sml"', html))
        cover_count = len(re.findall(r'class="u-cover[^"]*"', html))
        print(f"✓ {url.split('?')[1] if '?' in url else 'no params':30s} cover={cover_count} sml={sml_count} total_len={len(html)}")
        
        # Check for pagination elements
        if 'page' in html.lower() or 'pagination' in html.lower() or '分页' in html:
            print(f"  → Has pagination element!")
        # Check for next page link
        for m in re.finditer(r'(?:下一页|下一页|page|下一页|>下一页<)', html):
            print(f"  → Next page link found: {m.group()}")
    except Exception as e:
        print(f"✗ {url}: ERROR {e}")
