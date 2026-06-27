import sys
import re

def fix_warp():
    with open("frontend/src/App.jsx", "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Replace useState with useRef for hasInitializedWarp
    content = content.replace(
        "const [hasInitializedWarp, setHasInitializedWarp] = useState(false);",
        "const hasInitializedWarpRef = useRef(false);"
    )
    
    # 2. Update fetchData logic
    content = content.replace(
        "!hasInitializedWarp) {",
        "!hasInitializedWarpRef.current) {"
    )
    content = content.replace(
        "setHasInitializedWarp(true);",
        "hasInitializedWarpRef.current = true;"
    )
    
    # 3. Remove hasInitializedWarp from dependency array
    content = content.replace(
        "}, [hasInitializedWarp]);",
        "}, []);"
    )
    
    # 4. Remove ' V2'
    content = content.replace("SOLARFORGE V2", "SOLARFORGE")
    content = content.replace("SolarForge V2", "SolarForge")
    
    with open("frontend/src/App.jsx", "w", encoding="utf-8") as f:
        f.write(content)
        
    print("Done")

if __name__ == "__main__":
    fix_warp()
