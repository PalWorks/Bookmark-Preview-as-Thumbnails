from PIL import Image
import os

source_path = "/home/palani/.gemini/antigravity/brain/45deb421-20fe-4af8-9de5-c8b2164b1d27/uploaded_image_1765356307905.png"
output_dir = "public/icons"

sizes = [16, 48, 128]

try:
    img = Image.open(source_path)
    # Convert to RGBA to support transparency if we were using a PNG source, 
    # but source is JPG so it will be opaque. That's fine.
    
    for size in sizes:
        # Resize using LANCZOS for high quality
        resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
        output_path = os.path.join(output_dir, f"icon{size}.png")
        resized_img.save(output_path, "PNG")
        print(f"Saved {output_path}")
        
except Exception as e:
    print(f"Error: {e}")
