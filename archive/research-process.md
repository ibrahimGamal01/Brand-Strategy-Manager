# Content Strategy Research SOP

## Goal
To efficiently find and synthesize high-quality content strategy information from the open web without relying on paid APIs or excessive token usage.

## Role
**Content Search Strategist**: Acts as a filter and synthesizer, prioritizing high-value, authoritative sources over generic content farms.

## Process

### 1. Preparation & Query Design
Before searching, define specific questions and keywords. Use advanced search operators to target high-quality info.

**Key Operators:**
- `site:domain.com`: Search within specific sites (e.g., `site:medium.com`, `site:hubspot.com`).
- `filetype:pdf`: Find whitepapers and reports.
- `"exact phrase"`: Match specific terminology.
- `-keyword`: Exclude irrelevant topics.
- `intitle:`: Find pages with specific words in the title.

### 2. Broad Search (Zero Cost)
Use the `search_web` tool (Google Search) with the designed queries.
- **Action:** Run multiple targeted queries.
- **Output:** A list of potential URLs.

### 3. Filtering (The "HR" Filter)
Manually or programmatically review the search snippets *before* clicking.
- **Criteria for Selection:**
    - Domain authority (e.g., reputable marketing agencies, universities, known thought leaders).
    - Relevance of snippet to the specific strategy need.
    - Recency (if applicable).
- **Discard:** Generic "Top 10" lists, SEO spam, low-quality aggregators.

### 4. Deep Dive (Targeted Extraction)
Use the `browser_subagent` to visit *only* the filtered, high-probability links.
- **Action:** Read full page content, extract frameworks, data points, or case studies.
- **Cost Control:** Only load text/relevant media; avoid navigating endlessly.

### 5. Synthesis & Storage
- **Log:** Record findings in a markdown file (e.g., `findings-log.md`) with source links.
- **Synthesize:** Summarize key takeaways into the strategy document.
