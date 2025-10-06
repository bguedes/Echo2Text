---
title: Parakeet-tdt-0.6b-v3 ONNX CPU
emoji: 🦀
colorFrom: green
colorTo: gray
sdk: gradio
sdk_version: 5.49.0
app_file: app.py
pinned: false
license: bsd-3-clause
short_description: Speech transcription (Nvidia/parakeet-tdt-0.6b-v3+onnx_asr)
---

This space uses Nvidia [parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) model in [onnx format](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) with [onnx-asr](https://github.com/istupakov/onnx-asr) backend.  
In theory with minor edits it can work both on CPU and GPU but I don't have access to ZeroGPU spaces to enable hardware acceleration.    
Locally I tested it with Nvidia RTX3060 and RTX4060Ti and it used about 6GB VRAM with 150s chunks.