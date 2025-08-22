#!/usr/bin/env python3
"""
OneFootball Daily Claim Automation Script - Improved Version
For Termux/Android usage

Requirements:
pip install selenium requests web3 eth-account

Usage:
python3 onefootball_claim.py
"""

import time
import json
import logging
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from web3 import Web3
from eth_account import Account
import random
import os

# Configuration
WEBSITE_URL = "https://ofc.onefootball.com/s2"
PRIVATE_KEY = "YOUR_PRIVATE_KEY_HERE"  # Replace with your private key
WAIT_TIMEOUT = 30
MAX_RETRIES = 3

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('onefootball_claim.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class OneFootballClaimer:
    def __init__(self, private_key):
        self.private_key = private_key
        self.account = Account.from_key(private_key)
        self.wallet_address = self.account.address
        self.driver = None
        
    def setup_driver(self):
        """Setup Chrome driver for Termux"""
        try:
            chrome_options = Options()
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--disable-extensions')
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_argument('--disable-web-security')
            chrome_options.add_argument('--user-agent=Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36')
            chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            # For headless mode (optional, comment out if you want to see browser)
            # chrome_options.add_argument('--headless')
            
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            logger.info("Chrome driver initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to setup Chrome driver: {e}")
            return False
    
    def human_delay(self, min_delay=2, max_delay=5):
        """Add human-like random delay"""
        delay = random.uniform(min_delay, max_delay)
        time.sleep(delay)
        logger.info(f"Waited {delay:.2f} seconds")
    
    def scroll_and_wait(self):
        """Scroll page to trigger any lazy loading"""
        try:
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight/2);")
            self.human_delay(2, 3)
            self.driver.execute_script("window.scrollTo(0, 0);")
            self.human_delay(1, 2)
        except Exception as e:
            logger.warning(f"Error during scrolling: {e}")
    
    def wait_for_page_load(self):
        """Wait for page to fully load"""
        try:
            WebDriverWait(self.driver, 20).until(
                lambda driver: driver.execute_script("return document.readyState") == "complete"
            )
            self.human_delay(2, 4)
        except TimeoutException:
            logger.warning("Page load timeout")
    
    def connect_wallet(self):
        """Handle wallet connection with improved selectors"""
        try:
            logger.info("Looking for wallet connection button...")
            
            # Wait for page to load
            self.wait_for_page_load()
            self.scroll_and_wait()
            
            # More comprehensive wallet connect button selectors
            wallet_selectors = [
                "button[data-testid*='connect']",
                "button[class*='connect']",
                "button[class*='wallet']",
                "[data-testid='connect-wallet']",
                ".connect-wallet",
                ".wallet-connect",
                "button:contains('Connect')",
                "button:contains('Login')",
                "button:contains('Sign In')",
                "[role='button']:contains('Connect')"
            ]
            
            wallet_button = None
            
            # Try each selector
            for selector in wallet_selectors:
                try:
                    if ':contains(' in selector:
                        # Use XPath for text-based selectors
                        xpath = f"//button[contains(text(), '{selector.split(':contains(')[1].strip(')')}')] | //div[@role='button'][contains(text(), '{selector.split(':contains(')[1].strip(')')}')]"
                        wallet_button = WebDriverWait(self.driver, 5).until(
                            EC.element_to_be_clickable((By.XPATH, xpath))
                        )
                    else:
                        wallet_button = WebDriverWait(self.driver, 5).until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                        )
                    logger.info(f"Found wallet button with selector: {selector}")
                    break
                except TimeoutException:
                    continue
            
            # Fallback: search all buttons and divs by text
            if not wallet_button:
                logger.info("Trying text-based search for connect button...")
                all_clickable = self.driver.find_elements(By.XPATH, "//button | //div[@role='button'] | //a")
                for element in all_clickable:
                    try:
                        text = element.text.lower()
                        if any(keyword in text for keyword in ['connect', 'login', 'sign in', 'wallet']):
                            wallet_button = element
                            logger.info(f"Found wallet button by text: '{element.text}'")
                            break
                    except:
                        continue
            
            if wallet_button:
                logger.info("Clicking wallet connect button...")
                self.driver.execute_script("arguments[0].scrollIntoView(true);", wallet_button)
                self.human_delay(1, 2)
                wallet_button.click()
                self.human_delay(3, 6)
                
                # Handle wallet selection popup
                self.handle_wallet_popup()
                return True
            else:
                logger.warning("No wallet connect button found")
                return False
                
        except Exception as e:
            logger.error(f"Error connecting wallet: {e}")
            return False
    
    def handle_wallet_popup(self):
        """Handle wallet popup/modal with better detection"""
        try:
            logger.info("Handling wallet popup...")
            
            # Wait for popup to appear
            self.human_delay(2, 3)
            
            # Look for MetaMask or other wallet options
            wallet_options = [
                "//button[contains(text(), 'MetaMask')]",
                "//div[contains(@class, 'metamask')]//button",
                "//button[contains(text(), 'Injected')]",
                "//button[contains(text(), 'Browser Wallet')]",
                "//img[@alt='MetaMask']//parent::*//button"
            ]
            
            wallet_option_found = False
            for xpath in wallet_options:
                try:
                    option_btn = WebDriverWait(self.driver, 8).until(
                        EC.element_to_be_clickable((By.XPATH, xpath))
                    )
                    logger.info(f"Clicking wallet option: {option_btn.text}")
                    option_btn.click()
                    wallet_option_found = True
                    break
                except TimeoutException:
                    continue
            
            if not wallet_option_found:
                logger.info("No specific wallet option found, assuming direct connection")
            
            # Wait for wallet authentication
            logger.info("Waiting for wallet authentication...")
            self.human_delay(8, 12)
            
        except Exception as e:
            logger.error(f"Error handling wallet popup: {e}")
    
    def find_daily_claim_button(self):
        """Find and click daily claim button with better detection"""
        try:
            logger.info("Looking for daily claim button...")
            
            self.scroll_and_wait()
            
            # More comprehensive daily claim selectors
            daily_xpaths = [
                "//button[contains(text(), 'Daily')]",
                "//button[contains(text(), 'Claim')]", 
                "//button[contains(text(), 'Check-in')]",
                "//button[contains(text(), 'Check in')]",
                "//div[contains(@class, 'daily')]//button",
                "//div[contains(@class, 'claim')]//button",
                "//button[contains(@class, 'daily')]",
                "//button[contains(@class, 'claim')]"
            ]
            
            daily_button = None
            
            # Try XPath selectors first
            for xpath in daily_xpaths:
                try:
                    daily_button = WebDriverWait(self.driver, 8).until(
                        EC.element_to_be_clickable((By.XPATH, xpath))
                    )
                    logger.info(f"Found daily button with xpath: {xpath}")
                    break
                except TimeoutException:
                    continue
            
            # CSS selectors as fallback
            if not daily_button:
                css_selectors = [
                    "button[data-testid*='daily']",
                    "button[data-testid*='claim']",
                    ".daily-button",
                    ".claim-button"
                ]
                
                for selector in css_selectors:
                    try:
                        daily_button = WebDriverWait(self.driver, 5).until(
                            EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                        )
                        break
                    except TimeoutException:
                        continue
            
            if daily_button:
                logger.info(f"Found daily button: '{daily_button.text}', clicking...")
                self.driver.execute_script("arguments[0].scrollIntoView(true);", daily_button)
                self.human_delay(1, 2)
                daily_button.click()
                self.human_delay(3, 5)
                return True
            else:
                logger.warning("Daily claim button not found")
                # Save screenshot for debugging
                self.save_screenshot("daily_button_not_found")
                return False
                
        except Exception as e:
            logger.error(f"Error finding daily claim button: {e}")
            return False
    
    def verify_claim(self):
        """Click verification button after daily claim"""
        try:
            logger.info("Looking for verification button...")
            
            verify_xpaths = [
                "//button[contains(text(), 'Verify')]",
                "//button[contains(text(), 'Confirm')]",
                "//button[contains(text(), 'Complete')]",
                "//button[contains(text(), 'Finish')]",
                "//div[contains(@class, 'verify')]//button",
                "//div[contains(@class, 'confirm')]//button"
            ]
            
            verify_button = None
            
            for xpath in verify_xpaths:
                try:
                    verify_button = WebDriverWait(self.driver, 10).until(
                        EC.element_to_be_clickable((By.XPATH, xpath))
                    )
                    logger.info(f"Found verify button with xpath: {xpath}")
                    break
                except TimeoutException:
                    continue
            
            if verify_button:
                logger.info(f"Found verify button: '{verify_button.text}', clicking...")
                self.driver.execute_script("arguments[0].scrollIntoView(true);", verify_button)
                self.human_delay(1, 2)
                verify_button.click()
                self.human_delay(3, 5)
                return True
            else:
                logger.warning("Verify button not found - might not be needed")
                return True  # Sometimes verification is automatic
                
        except Exception as e:
            logger.error(f"Error finding verify button: {e}")
            return False
    
    def check_success(self):
        """Check if claim was successful with better indicators"""
        try:
            logger.info("Checking claim success...")
            self.human_delay(3, 5)
            
            # Check page source for success indicators
            page_text = self.driver.page_source.lower()
            
            success_keywords = [
                "success", "claimed", "completed", "earned", "reward", 
                "points", "congratulations", "well done", "great job",
                "daily reward", "claim successful"
            ]
            
            found_keywords = []
            for keyword in success_keywords:
                if keyword in page_text:
                    found_keywords.append(keyword)
            
            if found_keywords:
                logger.info(f"Success indicators found: {', '.join(found_keywords)}")
                return True
            
            # Check for success elements
            success_selectors = [
                ".success",
                ".completed",
                ".claimed",
                "[class*='success']",
                "[class*='complete']"
            ]
            
            for selector in success_selectors:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    for element in elements:
                        if element.is_displayed():
                            logger.info(f"Success element found: {element.text}")
                            return True
                except:
                    continue
            
            logger.warning("No clear success indicator found")
            self.save_screenshot("claim_result")
            return False
            
        except Exception as e:
            logger.error(f"Error checking success: {e}")
            return False
    
    def save_screenshot(self, name):
        """Save screenshot for debugging"""
        try:
            filename = f"screenshot_{name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            self.driver.save_screenshot(filename)
            logger.info(f"Screenshot saved: {filename}")
        except Exception as e:
            logger.warning(f"Could not save screenshot: {e}")
    
    def run_claim(self):
        """Main claim process with retry logic"""
        for attempt in range(MAX_RETRIES):
            try:
                logger.info(f"Starting claim attempt {attempt + 1}/{MAX_RETRIES}")
                logger.info(f"Using wallet address: {self.wallet_address}")
                
                # Setup browser
                if not self.setup_driver():
                    logger.error("Failed to setup driver")
                    continue
                
                # Navigate to website
                logger.info(f"Navigating to {WEBSITE_URL}")
                self.driver.get(WEBSITE_URL)
                self.wait_for_page_load()
                self.save_screenshot("initial_page")
                
                # Connect wallet
                if not self.connect_wallet():
                    logger.error("Failed to connect wallet")
                    self.save_screenshot("wallet_connection_failed")
                    continue
                
                self.save_screenshot("wallet_connected")
                
                # Wait for page to load after connection
                self.wait_for_page_load()
                
                # Click daily claim
                if not self.find_daily_claim_button():
                    logger.error("Failed to find daily claim button")
                    continue
                
                self.save_screenshot("after_daily_click")
                
                # Click verification (if needed)
                self.verify_claim()
                
                # Check if successful
                success = self.check_success()
                
                if success:
                    logger.info("✅ Daily claim completed successfully!")
                    return True
                else:
                    logger.warning("⚠️ Claim process completed but success unclear")
                    if attempt < MAX_RETRIES - 1:
                        logger.info("Retrying...")
                        continue
                    return False
                    
            except Exception as e:
                logger.error(f"Unexpected error during attempt {attempt + 1}: {e}")
                if attempt < MAX_RETRIES - 1:
                    logger.info("Retrying...")
                    continue
            
            finally:
                if self.driver:
                    self.driver.quit()
                    self.driver = None
        
        logger.error("All attempts failed")
        return False
    
    def save_result(self, success):
        """Save claim result to file"""
        try:
            result = {
                "timestamp": datetime.now().isoformat(),
                "wallet_address": self.wallet_address,
                "success": success,
                "website": WEBSITE_URL
            }
            
            # Create results directory if it doesn't exist
            os.makedirs("results", exist_ok=True)
            
            with open("results/claim_results.json", "a") as f:
                f.write(json.dumps(result) + "\n")
                
        except Exception as e:
            logger.error(f"Error saving result: {e}")

def main():
    """Main function"""
    if PRIVATE_KEY == "YOUR_PRIVATE_KEY_HERE":
        print("❌ Please set your private key in the script!")
        print("Edit PRIVATE_KEY variable at the top of the script")
        return
    
    try:
        claimer = OneFootballClaimer(PRIVATE_KEY)
        success = claimer.run_claim()
        claimer.save_result(success)
        
        if success:
            print("🎉 OneFootball daily claim completed!")
        else:
            print("❌ Daily claim failed. Check logs for details.")
            
    except Exception as e:
        logger.error(f"Script failed: {e}")
        print(f"❌ Script error: {e}")

if __name__ == "__main__":
    main()