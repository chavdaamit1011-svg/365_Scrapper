import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("TheScrapper.PlaywrightCrawler")

try:
    from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page
    PLAYWRIGHT_INSTALLED = True
except ImportError:
    PLAYWRIGHT_INSTALLED = False


class PlaywrightCrawlerEngine:
    """
    High-performance headless Playwright Crawler for single-page applications (Next.js, React,
    Vue, Shopify, WooCommerce). Handles dynamic client-side DOM hydration, resource blocking
    for speed, and deep page inspection.
    """

    def __init__(self, headless: bool = True, timeout_ms: int = 15000):
        self.headless = headless
        self.timeout_ms = timeout_ms
        self._pw = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self.is_active = False

    def start(self) -> bool:
        """Initializes the shared Playwright browser instance with resource optimization."""
        if not PLAYWRIGHT_INSTALLED:
            logger.info("[Playwright] Playwright package is not installed. Running in standard HTTP mode.")
            return False

        if self.is_active and self._browser:
            return True

        try:
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            self._context = self._browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                viewport={"width": 1366, "height": 768},
                ignore_https_errors=True,
            )

            # Block heavy assets (images, fonts, media) to make crawling 5x faster
            def block_heavy_resources(route):
                if route.request.resource_type in ["image", "media", "font"]:
                    route.abort()
                else:
                    route.continue_()

            self._context.route("**/*", block_heavy_resources)
            self.is_active = True
            logger.info("[Playwright] Headless Chromium crawler engine initialized with asset optimization.")
            return True
        except Exception as e:
            logger.warning(f"[Playwright] Failed to start Playwright browser: {e}. Falling back to standard requests.")
            self.stop()
            return False

    def render_page(self, url: str) -> Optional[str]:
        """
        Loads the URL using headless browser, waits for DOM hydration,
        and returns the fully rendered HTML source.
        """
        if not self.is_active or not self._context:
            started = self.start()
            if not started:
                return None

        page: Optional[Page] = None
        try:
            page = self._context.new_page()
            page.set_default_timeout(self.timeout_ms)

            # Navigate and wait for DOM content loaded
            page.goto(url, wait_until="domcontentloaded")

            # Brief grace period for client-side JavaScript / Next.js hydration
            page.wait_for_timeout(800)

            rendered_html = page.content()
            return rendered_html
        except Exception as err:
            logger.warning(f"[Playwright] Error rendering {url}: {err}")
            return None
        finally:
            if page:
                try:
                    page.close()
                except Exception:
                    pass

    def render_and_inspect(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Renders the page with full DOM execution and directly evaluates
        dynamic links, title, and rendered HTML.
        """
        if not self.is_active or not self._context:
            started = self.start()
            if not started:
                return None

        page: Optional[Page] = None
        try:
            page = self._context.new_page()
            page.set_default_timeout(self.timeout_ms)

            response = page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(800)

            title = page.title()
            html = page.content()
            status_code = response.status if response else 200

            # Extract dynamic links directly from DOM
            hrefs = page.eval_on_selector_all("a[href]", "elements => elements.map(e => e.getAttribute('href'))")

            return {
                "html": html,
                "title": title,
                "status_code": status_code,
                "links": [h for h in hrefs if h],
            }
        except Exception as err:
            logger.warning(f"[Playwright] Error during page inspection of {url}: {err}")
            return None
        finally:
            if page:
                try:
                    page.close()
                except Exception:
                    pass

    def extract_dynamic_page(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Renders the page in Chromium, waits for DOM hydration,
        and directly queries DOM for dynamic mailto links, Cloudflare protected emails,
        contact blocks, links, and HTML.
        """
        if not self.is_active or not self._context:
            started = self.start()
            if not started:
                return None

        page: Optional[Page] = None
        try:
            page = self._context.new_page()
            page.set_default_timeout(self.timeout_ms)

            response = page.goto(url, wait_until="domcontentloaded")
            # Wait for client-side JavaScript / Next.js hydration
            page.wait_for_timeout(1000)

            title = page.title()
            html = page.content()
            status_code = response.status if response else 200

            # Direct DOM extraction of mailto, cf-emails, contact blocks, and links
            dom_data = page.evaluate("""() => {
                const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:" i]'))
                    .map(a => a.getAttribute('href') || '');

                const cfProtected = Array.from(document.querySelectorAll('[data-cfemail]'))
                    .map(el => el.getAttribute('data-cfemail') || '');

                const contactElements = Array.from(
                    document.querySelectorAll('address, footer, header, [id*="contact" i], [class*="contact" i]')
                ).map(el => el.innerText || '');

                const allHrefs = Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.getAttribute('href') || '');

                return {
                    mailtos: mailtos,
                    cfProtected: cfProtected,
                    contactText: contactElements.join('\\n'),
                    hrefs: allHrefs
                };
            }""")

            return {
                "html": html,
                "title": title,
                "status_code": status_code,
                "mailtos": dom_data.get("mailtos", []),
                "cfProtected": dom_data.get("cfProtected", []),
                "contactText": dom_data.get("contactText", ""),
                "links": dom_data.get("hrefs", []),
            }
        except Exception as err:
            logger.warning(f"[Playwright] Error extracting dynamic page {url}: {err}")
            return None
        finally:
            if page:
                try:
                    page.close()
                except Exception:
                    pass

    def stop(self) -> None:
        """Closes browser and stops Playwright runtime."""
        try:
            if self._context:
                self._context.close()
            if self._browser:
                self._browser.close()
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        finally:
            self._context = None
            self._browser = None
            self._pw = None
            self.is_active = False


# Backward-compatible alias
PlaywrightFallbackEngine = PlaywrightCrawlerEngine

