require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { Manager } = require("erela.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

client.manager = new Manager({
  nodes: [
    {
      host: "127.0.0.1",
      port: 2333,
      password: "youshallnotpass",
      retryAmount: 10,
      retryDelay: 5000,
    },
  ],
  send: (id, payload) => {
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  },
});

client.once("ready", () => {
  console.log(`${client.user.tag} hazır`);
  client.manager.init(client.user.id);
});

/* voice state */
client.on("raw", (d) => client.manager.updateVoiceState(d));

/* debug */
client.manager.on("nodeConnect", node => {
  console.log("✅ Lavalink bağlandı:", node.options.host);
});

client.manager.on("nodeError", (node, error) => {
  console.log("❌ Lavalink hata:", error);
});

/* COMMANDS */
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const player = client.manager.get(message.guild.id);

  /* PLAY */
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const search = args.join(" ");
    if (!search) return message.reply("Şarkı yaz");

    const res = await client.manager.search(search, message.author);

    if (!player) {
      const p = client.manager.create({
        guild: message.guild.id,
        voiceChannel: voice.id,
        textChannel: message.channel.id,
        selfDeafen: true,
      });

      p.connect();
      p.queue.add(res.tracks[0]);
      p.play();
    } else {
      player.queue.add(res.tracks[0]);
      message.reply("➕ eklendi");
    }
  }

  /* SKIP */
  if (cmd === "skip") {
    if (!player) return;
    player.stop();
    message.reply("⏭ skip");
  }

  /* STOP */
  if (cmd === "stop") {
    if (!player) return;
    player.destroy();
    message.reply("⛔ stop");
  }

  /* QUEUE */
  if (cmd === "queue") {
    if (!player) return message.reply("boş");

    message.reply(
      player.queue.map((t, i) => `${i + 1}. ${t.title}`).join("\n")
    );
  }
});

client.login(process.env.TOKEN);
