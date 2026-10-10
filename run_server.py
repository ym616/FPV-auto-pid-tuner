#!/usr/bin/env python3
"""
AeroPID Pro - Local Telemetry Web Server
Serves the web application and sample logs locally with automatic port selection
and browser launch.
"""

import os
import sys
import socket
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

class QuietHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and caching headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Clean logging format
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

def find_available_port(start_port=8080, max_attempts=20):
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return start_port

def run():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    port = find_available_port(8080)
    server_address = ('127.0.0.1', port)
    httpd = HTTPServer(server_address, QuietHandler)

    url = f"http://127.0.0.1:{port}/index.html"

    print("=" * 65)
    print("  🚀 AeroPID Pro — FPV Gyro Analyzer & PID Tuning Suite")
    print("=" * 65)
    print(f"  Local Web Server: {url}")
    print(f"  Serving Directory: {base_dir}")
    print("  Press Ctrl+C to stop the server.")
    print("=" * 65)

    # Launch browser
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not automatically open browser: {e}")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        httpd.server_close()

if __name__ == '__main__':
    run()
