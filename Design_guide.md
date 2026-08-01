# Smart Factory Quality & Production Dashboard Guidelines

## 1. Target Devices & Layout
- Main Platforms: PC (1920x1080) & Tablet (iPad/Galaxy Tab, Landscape mode)
- Layout: Responsive Grid (Sidebar + Top Navbar + Multi-column Content Zone)
- Minimum Touch Target: 48px x 48px for Tablet usability

## 2. Color Palette & Typography
- Background: #F8FAFC (Clean Light Slate)
- Surface/Card: #FFFFFF with border-color #E2E8F0 (1px solid)
- Primary (Brand): #2563EB (Navy/Royal Blue)
- Success (Pass): #16A34A (Green)
- Warning (Caution): #D97706 (Amber)
- Danger (Defect/Alert): #DC2626 (Vivid Red)
- Font: Inter or System Sans-Serif (Bold hierarchy for KPIs)

## 3. Page Structure & Components

### A. Main Dashboard Overview (Summary Page)
- **Top Row (KPI Cards):** Total Produced, Defect Rate (%), Current Temp/Humidity, Shift Handover Status.
- **Middle Left (Real-time Monitoring):** Line chart showing temperature trends over time with LCL/UCL bounds.
- **Middle Right (Visual Inspection):** Grid of recently scanned defect cells with image thumbnails and tags.
- **Bottom Row (Shift Log):** Handover notes feed with 'Acknowledge' status badges.

### B. Module 1: Visual Inspection (외관 검사)
- Layout: Split view (Left: Inspection Form & Photo Capture, Right: Defect Gallery Table)
- Image Capture Component: Supports drag-and-drop or device camera upload, inline preview.

### C. Module 2: Environment Monitoring (온도 모니터링)
- Real-time Chart (Chart.js or Recharts recommended)
- High-temp Alert Indicator with visual badge when values exceed threshold.

### D. Module 3: Shift Handover Log (작업 일지)
- Timeline UI format divided by Shift (Shift A, Shift B, Shift C)
- Includes Quick Category Tags, Text Notes, and Digital Sign/Confirmation Button.
