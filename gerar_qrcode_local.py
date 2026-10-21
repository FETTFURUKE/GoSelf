#!/usr/bin/env python3
"""
Script Utilitário: Gerador de QR Code GoSelf em Alta Resolução (300 DPI / 1024x1024)
Projeto: Totem de Autoatendimento GoSelf (Mundo SENAI 2026)
Autor: João A. Bernardo | TDESI
"""

import sys
import urllib.request
import urllib.parse
import os

DEFAULT_URL = "https://fettfuruke.github.io/GoSelf/"
OUTPUT_PNG = "qrcode_goself_alta_resolucao.png"

def gerar_qrcode(url=DEFAULT_URL, output_path=OUTPUT_PNG, tamanho=1000):
    print(f"[+] Gerando QR Code em Alta Resolução ({tamanho}x{tamanho})...")
    print(f"    Destino: {url}")
    
    encoded_url = urllib.parse.quote(url)
    api_url = f"https://api.qrserver.com/v1/create-qr-code/?size={tamanho}x{tamanho}&margin=20&data={encoded_url}"
    
    req = urllib.request.Request(
        api_url, 
        headers={'User-Agent': 'Mozilla/5.0 (GoSelf QR Generator)'}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            data = response.read()
            with open(output_path, "wb") as f:
                f.write(data)
        
        abs_path = os.path.abspath(output_path)
        print(f"[OK] QR Code salvo com sucesso!")
        print(f"     Arquivo: {abs_path}")
        print(f"     Tamanho do arquivo: {len(data):,} bytes")
        return True
    except Exception as e:
        print(f"[ERRO] Falha ao gerar QR Code: {e}")
        return False

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    out = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_PNG
    gerar_qrcode(target, out)
