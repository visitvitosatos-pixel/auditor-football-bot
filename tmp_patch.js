async function fetchMatches() {
  try {
    const today = new Date().toISOString().split("T")[0];

    const res = await axios.get(
      `https://api.football-data.org/v4/matches?status=SCHEDULED&dateFrom=${today}&dateTo=${today}`,
      {
        headers: { "X-Auth-Token": API_KEY },
        timeout: 15000
      }
    );

    return res.data.matches || [];
  } catch (err) {
    if (err.response) {
      const code = err.response.status;
      if (code === 403) throw new Error("API 403 — проверь ключ");
      if (code === 429) throw new Error("API 429 — лимит");
      throw new Error("API ошибка: " + code);
    }
    if (err.code === "ECONNABORTED") {
      throw new Error("API timeout");
    }
    throw new Error("Сетевая ошибка");
  }
}
