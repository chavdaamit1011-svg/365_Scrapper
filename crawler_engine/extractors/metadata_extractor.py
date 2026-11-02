from typing import Dict, Any, List


def extract_page_metadata(soup, url: str) -> Dict[str, Any]:
    """
    Extracts structured page metadata: title, meta description,
    H1 headings, language, OpenGraph information, and content snippet.
    """
    # Title
    title = ""
    title_tag = soup.find("title")
    if title_tag and title_tag.string:
        title = title_tag.string.strip()
    elif soup.find("meta", property="og:title"):
        title = soup.find("meta", property="og:title").get("content", "").strip()

    # Meta Description
    description = ""
    desc_tag = soup.find("meta", attrs={"name": "description"})
    if desc_tag and desc_tag.get("content"):
        description = desc_tag.get("content", "").strip()
    elif soup.find("meta", property="og:description"):
        description = soup.find("meta", property="og:description").get("content", "").strip()

    # H1 Headings
    h1_list: List[str] = []
    for h1 in soup.find_all("h1"):
        text = h1.get_text(strip=True)
        if text and text not in h1_list:
            h1_list.append(text)

    # HTML Language
    html_tag = soup.find("html")
    lang = html_tag.get("lang", "") if html_tag else ""

    # OpenGraph Tags
    og_image = ""
    og_img_tag = soup.find("meta", property="og:image")
    if og_img_tag:
        og_image = og_img_tag.get("content", "").strip()

    # Word count estimation
    text = soup.get_text(separator=" ", strip=True)
    words = len(text.split())

    return {
        "url": url,
        "title": title,
        "description": description,
        "h1_headings": h1_list,
        "language": lang,
        "og_image": og_image,
        "word_count": words,
        "text_preview": text[:250] if text else "",
    }

