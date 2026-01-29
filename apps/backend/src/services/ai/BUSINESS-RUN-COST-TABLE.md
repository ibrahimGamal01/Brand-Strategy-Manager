# Business Run Cost Table 💰

**Context**: Cost for processing ONE complete business Brand Strategy, from initial data intake to final document generation.

| Phase | Activity | Details | Cost (USD) |
| :--- | :--- | :--- | :--- |
| **1. AI Intelligence** | **12 Strategic Questions** | GPT-4o analysis of brand inputs<br>*(11 initial + 1 content opportunity)* | **$1.12** |
| **2. Competitor Analysis** | **Competitor Discovery** | 10 Competitors + 3 Priority<br>*Algorithmic search + AI filtering* | **$0.00*** |
|  | **Social Scraping** | Instagram/TikTok Post Data<br>*Python Scripts (Instaloader/yt-dlp)* | **$0.00** |
| **3. RAG Workflow** | **Context Assembly** | Data retrieval & Quality Scoring<br>*Database queries only* | **$0.00** |
| **4. Strategy Generation** | **Business Understanding** | Brand Voice, UVP, Overview<br>*Generation + Validation Loop* | ~$0.10 |
|  | **Target Audience** | Personas, JTBD, Pain Points<br>*Generation + Validation Loop* | ~$0.08 |
|  | **Industry Overview** | Market Analysis, Competitor Table<br>*Generation + Validation Loop* | ~$0.08 |
|  | **Priority Competitors** | Deep Dive, Blue Ocean Strategy<br>*Generation + Validation Loop* | ~$0.12 |
|  | **Content Analysis** | Playbook, Content Pillars<br>*Generation + Validation Loop* | ~$0.10 |
| **TOTAL** | **One Complete Run** | **Full End-to-End Strategy** | **~$1.60** |

---

### Key Notes

1.  **AI Questions ($1.12)**: This is the "heavy lift" done once per business to establish the strategic foundation. It feeds into everything else.
2.  **Zero-Cost Phases**:
    *   **Competitor Discovery**: Uses algorithmic search APIs (DDG) which are free/low-cost or heavily cached.
    *   **Social Scraping**: Now uses our custom Python scrapers (Instaloader/yt-dlp) which run on your server for **$0**.
    *   **RAG**: Internal database operations are free.
3.  **Generation Costs ($0.48)**:
    *   Includes **Validation Loops**: If a section isn't perfect, it auto-regenerates (cost includes average retries).
    *   Uses **GPT-4o**: The highest quality model. (could be reduced to ~$0.15 using GPT-4o-mini).

**ROI**: Comparable manual work would cost **$360 - $800** (12-16 hours of strategist time).
