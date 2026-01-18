const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const apiClient = {
  // Client endpoints
  async getClients() {
    const res = await fetch(`${API_BASE}/clients`);
    return res.json();
  },

  async createClient(data: { name: string; handle: string; platform?: string }) {
    const res = await fetch(`${API_BASE}/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // Research Jobs
  async getResearchJob(jobId: string) {
    const res = await fetch(`${API_BASE}/research-jobs/${jobId}`);
    return res.json();
  },

  async getResearchJobs() {
    const res = await fetch(`${API_BASE}/research-jobs`);
    return res.json();
  },

  // Media
  async getPostMedia(postId: string) {
    const res = await fetch(`${API_BASE}/media/post/${postId}`);
    return res.json();
  },

  // Competitors
  async getCompetitors(clientId: string) {
    const res = await fetch(`${API_BASE}/competitors/client/${clientId}`);
    return res.json();
  },

  async confirmCompetitor(discoveredId: string) {
    const res = await fetch(`${API_BASE}/competitors/discovered/${discoveredId}/confirm`, {
      method: 'POST',
    });
    return res.json();
  },

  async rejectCompetitor(discoveredId: string) {
    const res = await fetch(`${API_BASE}/competitors/discovered/${discoveredId}/reject`, {
      method: 'POST',
    });
    return res.json();
  },

  async createResearchJob(clientId: string) {
    const res = await fetch(`${API_BASE}/research-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    return res.json();
  },

  async getCompetitorAnalysis(competitorId: string) {
    const res = await fetch(`${API_BASE}/competitors/${competitorId}/analysis`);
    return res.json();
  },

  // Analytics
  async getClientAnalytics(clientId: string) {
    const res = await fetch(`${API_BASE}/analytics/client/${clientId}`);
    return res.json();
  },

  async getTopPosts(clientId: string, metric = 'likes', limit = 10) {
    const res = await fetch(
      `${API_BASE}/analytics/client/${clientId}/top-posts?metric=${metric}&limit=${limit}`
    );
    return res.json();
  },
};
