import logging
from typing import Optional

logger = logging.getLogger("TheScrapper.PlaywrightFallback")

try:
    from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page
    PLAYWRIGHT_INSTALLED = True
except ImportError:
    PLAYWRIGHT_INSTALLED = False


class PlaywrightFallbackEngine:
    """
    Manages a single reusable headless Playwright browser instance
    for JavaScript-rendered single-page applications (SPAs) or dynamically
    loaded pages when standard HTML responses miss important content.
    """

    def __init__(self, headless: bool = True, timeout_ms: int = 15000):
        self.headless = headless
        self.timeout_ms = timeout_ms
        self._pw = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self.is_active = False

    def start(self) -> bool:
        """Initializes the shared browser instance."""
        if not PLAYWRIGHT_INSTALLED:
            logger.info("[Playwright] Playwright package is not installed. Running in standard HTTP mode.")
            return False

        if self.is_active and self._browser:
            return True

        try:
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=self.headless)
            self._context = self._browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 800},
            )
            self.is_active = True
            logger.info("[Playwright] Shared headless browser instance started.")
            return True
        except Exception as e:
            logger.warning(f"[Playwright] Failed to start Playwright browser: {e}. Falling back to standard requests.")
            self.stop()
            return False

    def render_page(self, url: str) -> Optional[str]:
        """
        Loads the URL using the shared browser, waits for network idle or DOM load,
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
            
            # Navigate and wait for DOM content
            response = page.goto(url, wait_until="domcontentloaded")
            
            # Small grace period for client-side hydration
            page.wait_for_timeout(1000)
            
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

