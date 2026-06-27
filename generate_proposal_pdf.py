import os
import sys
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib import colors
from reportlab.pdfgen import canvas

class SolarForgeProposalCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pages = []

    def showPage(self):
        self.pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self.pages)
        for page in self.pages:
            self.__dict__.update(page)
            self.draw_page_number(num_pages)
            super().showPage()
        super().save()

    def draw_page_number(self, page_count):
        # We don't draw header/footer on slide 1 (cover) or slide 10 (thank you)
        if self._pageNumber == 1 or self._pageNumber == 10:
            return
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#94a3b8"))
        self.drawString(40, 30, "ISRO Bharatiya Antariksh Hackathon 2026 // Team SolarForge")
        self.drawRightString(801.89, 30, f"Slide {self._pageNumber} of {page_count}")
        self.restoreState()


def draw_slide_header(c, title):
    # Draw dark header background
    c.setFillColor(colors.HexColor("#0f172a")) # Slate 900
    c.rect(0, 525, 841.89, 70, stroke=0, fill=1)
    
    # Draw ISRO theme accent lines
    c.setFillColor(colors.HexColor("#f97316")) # Orange
    c.rect(0, 522, 420.94, 3, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0ea5e9")) # Blue
    c.rect(420.94, 522, 420.95, 3, stroke=0, fill=1)

    # Header text
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(40, 545, title)
    
    # Subtitle or tracking info
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#f97316"))
    c.drawRightString(801.89, 550, "SUBMISSION ID: HACKATHON-2026-SOLARFORGE")


def draw_bullet_points(c, points, start_x, start_y, line_height=20, font_size=11):
    c.saveState()
    c.setFont("Helvetica", font_size)
    c.setFillColor(colors.HexColor("#334155")) # Slate 700
    y = start_y
    for pt in points:
        if pt.startswith("**"):
            # Split bold title
            parts = pt.split("**")
            bold_part = parts[1]
            regular_part = parts[2] if len(parts) > 2 else ""
            c.setFont("Helvetica-Bold", font_size)
            c.drawString(start_x, y, f"•  {bold_part}")
            w = c.stringWidth(f"•  {bold_part}", "Helvetica-Bold", font_size)
            c.setFont("Helvetica", font_size)
            c.drawString(start_x + w, y, regular_part)
        else:
            c.drawString(start_x, y, f"•  {pt}")
        y -= line_height
    c.restoreState()


def build_proposal_pdf(output_path):
    c = canvas.Canvas(output_path, pagesize=landscape(A4), pageCompression=1)
    # A4 Landscape: width = 841.89, height = 595.27
    width, height = landscape(A4)
    
    # Override with two-pass canvas for correct page counts
    c = SolarForgeProposalCanvas(output_path, pagesize=landscape(A4))

    # ==========================================
    # SLIDE 1: Cover Slide
    # ==========================================
    c.setFillColor(colors.HexColor("#090d16")) # Space Black
    c.rect(0, 0, width, height, stroke=0, fill=1)
    
    # Decorative space background glow (using reportlab shapes)
    c.setFillColor(colors.HexColor("#1e1b4b")) # Dark Indigo
    c.circle(width - 100, height - 100, 250, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0f172a")) # Slate 900
    c.circle(width - 100, height - 100, 200, stroke=0, fill=1)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(40, 420, "BHARATIYA ANTARIKSH HACKATHON")
    c.setFillColor(colors.HexColor("#f97316")) # Orange
    c.drawString(40, 370, "HACKATHON 2026")
    
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, 310, "TEAM NAME:  TEAM SOLARFORGE")
    c.drawString(40, 280, "TEAM LEADER:  [Team Leader Name]")
    c.drawString(40, 250, "PROBLEM STATEMENT:")
    
    c.setFont("Helvetica", 11)
    c.setFillColor(colors.HexColor("#94a3b8")) # Slate 400
    ps_text = ("Real-time Space Weather Nowcasting and Solar Flare Forecasting using "
               "uncalibrated Level-0 orbital telemetry (ISRO Aditya-L1 SoLEXS & HEL1OS instruments).")
    c.drawString(40, 225, ps_text)

    # Accent color blocks
    c.setFillColor(colors.HexColor("#f97316"))
    c.rect(40, 190, 80, 4, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0ea5e9"))
    c.rect(125, 190, 80, 4, stroke=0, fill=1)

    c.showPage()

    # ==========================================
    # SLIDE 2: Team Members
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc")) # Slate 50
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "Team Members")

    # Team Leader Card
    c.setFillColor(colors.HexColor("#ffffff"))
    c.setStrokeColor(colors.HexColor("#e2e8f0"))
    c.roundRect(40, 280, 360, 200, 8, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#f97316"))
    c.rect(40, 465, 360, 15, stroke=0, fill=1) # Top ribbon
    
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(60, 430, "Team Leader")
    c.setFont("Helvetica", 12)
    c.drawString(60, 400, "Name: [Team Leader Name]")
    c.drawString(60, 375, "Role: Team Leader & Domain Expert")
    c.drawString(60, 350, "College: [College Name]")

    # Member 1 Card
    c.setFillColor(colors.HexColor("#ffffff"))
    c.roundRect(440, 280, 360, 200, 8, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#0ea5e9"))
    c.rect(440, 465, 360, 15, stroke=0, fill=1)
    
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(460, 430, "Team Member-1")
    c.setFont("Helvetica", 12)
    c.drawString(460, 400, "Name: [Team Member 1 Name]")
    c.drawString(460, 375, "Role: Lead Architect & Developer")
    c.drawString(460, 350, "College: [College Name]")

    # Member 2 Card
    c.setFillColor(colors.HexColor("#ffffff"))
    c.roundRect(40, 60, 360, 200, 8, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#64748b"))
    c.rect(40, 245, 360, 15, stroke=0, fill=1)
    
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(60, 210, "Team Member-2")
    c.setFont("Helvetica", 12)
    c.drawString(60, 180, "Name: [Team Member 2 Name]")
    c.drawString(60, 155, "Role: Frontend UI Designer")
    c.drawString(60, 130, "College: [College Name]")

    # Member 3 Card
    c.setFillColor(colors.HexColor("#ffffff"))
    c.roundRect(440, 60, 360, 200, 8, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#64748b"))
    c.rect(440, 245, 360, 15, stroke=0, fill=1)
    
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(460, 210, "Team Member-3")
    c.setFont("Helvetica", 12)
    c.drawString(460, 180, "Name: [Team Member 3 Name]")
    c.drawString(460, 155, "Role: Domain Researcher")
    c.drawString(460, 130, "College: [College Name]")

    c.showPage()

    # ==========================================
    # SLIDE 3: Opportunity & Solution Alignment
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "Opportunity & Solution Alignment")

    c.setFillColor(colors.HexColor("#ffffff"))
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 470, "1. How different is it from other existing ideas?")
    draw_bullet_points(c, [
        "**Direct nowcasting on uncalibrated telemetry**: Operates instantly on raw Level-0 counts from SoLEXS & HEL1OS.",
        "**No latency wait**: Skips traditional post-calibration waiting times (which take hours/days) to reduce response time to <1 second.",
        "**Kinetic precursor engineering**: Uses 1st and 2nd derivatives (flux velocity & acceleration) instead of count thresholds."
    ], 75, 445, line_height=20)

    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 335, "2. How will it solve the problem?")
    draw_bullet_points(c, [
        "**High-throughput integration**: Uses DuckDB for out-of-core merging of massive datasets (71M+ rows) in under 3 seconds.",
        "**LightGBM forecasting model**: Predicts solar flares (C, M, X class) over five horizons (15m, 30m, 1h, 2h, 4h).",
        "**Outstanding metrics**: Achieves **86.03% (15m)** and **88.62% (4h) TSS** on X-class flares with **100% recall** (no missed events)."
    ], 75, 310, line_height=20)

    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 195, "3. USP of the proposed solution")
    draw_bullet_points(c, [
        "**End-to-End automated baseline**: Bridges the gap between uncalibrated telemetry streams and immediate emergency actions.",
        "**Interactive live dashboard**: Integrates warning indicators, physical flux logs, and active duration clocks into a single panel.",
        "**Ultra-low footprint**: Ingestion and inference engines run within a tiny RAM envelope (<40MB) suitable for edge nodes."
    ], 75, 170, line_height=20)

    c.showPage()

    # ==========================================
    # SLIDE 4: List of Features Offered
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "List of Features Offered by the Solution")

    c.setFillColor(colors.HexColor("#ffffff"))
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 15)
    
    # Left Column Features
    c.drawString(60, 460, "Data & Processing Features")
    draw_bullet_points(c, [
        "**Out-of-Core Ingestion**: Instant querying of 71M+ records via DuckDB.",
        "**Telemetry Cross-Alignment**: Synchronizes thermal SoLEXS and hard HEL1OS feeds.",
        "**Float32 Compression**: Shrinks memory storage footprint by 85%.",
        "**Optimized Gzipped Telemetry**: Compresses database to 13.9 MB for GitHub.",
        "**Low-Resource Footprint**: The entire server runs on Render free instances (<512MB)."
    ], 60, 430, line_height=30, font_size=12)

    # Right Column Features
    c.drawString(440, 460, "Model & UI Features")
    draw_bullet_points(c, [
        "**Multi-Horizon Lookahead**: Active alerts for +15m, +30m, +1h, +2h, and +4h.",
        "**LightGBM Classifier**: Predicts probabilities of imminent C, M, and X-class flares.",
        "**Solar Flux estimation**: Calculates real-time flux (W/m²) in scientific notation.",
        "**Dynamic Warning Matrix**: Color-coordinated panels (nominal, low, moderate, critical).",
        "**Progressive Web App**: Desktop and mobile installable with self-cleaning Service Worker."
    ], 440, 430, line_height=30, font_size=12)

    c.showPage()

    # ==========================================
    # SLIDE 5: Process Flow Diagram
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "Process Flow Diagram")

    # Card background
    c.setFillColor(colors.white)
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    # Draw workflow image
    c.drawImage("project_workflow.png", 50, 70, width=741.89, height=420, preserveAspectRatio=True, anchor='c')

    c.showPage()

    # ==========================================
    # SLIDE 6: Wireframes / Mock Diagrams
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "Wireframe Mockup of UI Dashboard")

    c.setFillColor(colors.white)
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    # Draw dashboard image
    c.drawImage("solar_dashboard.png", 50, 70, width=741.89, height=420, preserveAspectRatio=True, anchor='c')

    c.showPage()

    # ==========================================
    # SLIDE 7: Architecture Diagram
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "System Architecture")

    c.setFillColor(colors.white)
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    # Draw architecture image
    c.drawImage("architecture.png", 50, 70, width=741.89, height=420, preserveAspectRatio=True, anchor='c')

    c.showPage()

    # ==========================================
    # SLIDE 8: Technologies Used
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "Technologies Used in the Solution")

    c.setFillColor(colors.white)
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    techs = [
        ("Machine Learning", ["LightGBM Classifier", "Random Forest Ensembles", "Scikit-Learn & SciPy Ensembles"]),
        ("Data Engineering", ["DuckDB Ingest", "Pandas DataFrames", "PyArrow Parquet Structures"]),
        ("Backend Web Server", ["FastAPI Framework", "Uvicorn ASGI Engine", "Python 3.10+"]),
        ("Frontend Web App", ["React SPA Framework", "Vite Builder", "Recharts Dashboard Components"]),
        ("Deployment", ["GitHub", "Git Version Control", "Render Web Services Hosting"])
    ]

    x = 60
    y = 440
    for category, items in techs:
        c.setFillColor(colors.HexColor("#f97316"))
        c.setFont("Helvetica-Bold", 14)
        c.drawString(x, y, category)
        
        c.setFillColor(colors.HexColor("#334155"))
        c.setFont("Helvetica", 11)
        iy = y - 25
        for item in items:
            c.drawString(x + 15, iy, f"•  {item}")
            iy -= 22
            
        x += 150
        if x > 700:
            x = 60
            y = 220

    c.showPage()

    # ==========================================
    # SLIDE 9: Estimated Implementation Cost
    # ==========================================
    c.setFillColor(colors.HexColor("#f8fafc"))
    c.rect(0, 0, width, height, stroke=0, fill=1)
    draw_slide_header(c, "Estimated Implementation Cost")

    c.setFillColor(colors.white)
    c.roundRect(40, 60, 761.89, 440, 8, stroke=1, fill=1)

    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(60, 440, "Budget Breakdown")

    draw_bullet_points(c, [
        "**Software Licenses**: $0 -- All technologies (Python, DuckDB, LightGBM, React) are open-source and free.",
        "**Data Ingestion APIs**: $0 -- Free, open-access telemetry streams from ISRO and NOAA space portals.",
        "**Web Server Hosting**: $7 / month -- Host backend and database on standard Render Virtual Servers.",
        "**Frontend Application Hosting**: $0 -- Free static client hosting using Render or Vercel static pages.",
        "**Database Storage Cost**: $0 -- Telemetry compressed to 13.9 MB, staying far below git storage limits."
    ], 60, 390, line_height=40, font_size=13)

    c.setFillColor(colors.HexColor("#f0fdf4"))
    c.roundRect(60, 110, 720, 60, 6, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#16a34a"))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(80, 135, "TOTAL LAUNCH BUDGET:  $7.00 / month (Fully functional, production-ready system)")

    c.showPage()

    # ==========================================
    # SLIDE 10: Thank You cover slide
    # ==========================================
    c.setFillColor(colors.HexColor("#090d16")) # Space Black
    c.rect(0, 0, width, height, stroke=0, fill=1)
    
    # Decorative space background glow (using reportlab shapes)
    c.setFillColor(colors.HexColor("#1e1b4b"))
    c.circle(100, 100, 250, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0f172a"))
    c.circle(100, 100, 200, stroke=0, fill=1)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 40)
    c.drawString(40, 360, "THANK YOU")
    
    c.setFont("Helvetica-Bold", 14)
    c.setFillColor(colors.HexColor("#f97316"))
    c.drawString(40, 300, "Team SolarForge")

    c.setFont("Helvetica", 11)
    c.setFillColor(colors.HexColor("#94a3b8"))
    c.drawString(40, 240, "Live Webpage:  https://solar-flare-prediction-bscp.onrender.com")
    c.drawString(40, 215, "Source Code:  https://github.com/[GitHub Username]/[Repository Name]")

    c.showPage()

    c.save()


if __name__ == "__main__":
    out_path = "Bhant_Ant_Proposal_SolarForge.pdf"
    print(f"Generating proposal PDF: {out_path}...")
    build_proposal_pdf(out_path)
    print("Done!")
