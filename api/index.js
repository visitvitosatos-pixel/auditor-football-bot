module.exports = async (req, res) => {
  if (req.method === "POST") return res.status(200).send("OK");
  return res.status(200).send("API is working");
};
