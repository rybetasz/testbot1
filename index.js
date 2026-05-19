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
      host: "localhost",
      port: 2333,
      password: "youshallnotpass",
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

client.on("raw", (d) => client.manager.updateVoiceState(d));

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const player = client.manager.get(message.guild.id);

  // PLAY
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir.");

    const search = args.join(" ");
    if (!search) return message.reply("Bir şarkı yaz.");

    let res = await client.manager.search(search, message.author);

    if (!player) {
      const newPlayer = client.manager.create({
        guild: message.guild.id,
        voiceChannel: voice.id,
        textChannel: message.channel.id,
        selfDeafen: true,
      });

      newPlayer.connect();
      newPlayer.queue.add(res.tracks[0]);
      newPlayer.play();
    } else {
      player.queue.add(res.tracks[0]);
      message.reply("➕ Kuyruğa eklendi");
    }
  }

  // SKIP
  if (cmd === "skip") {
    if (!player) return;
    player.stop();
    message.reply("⏭ Skip");
  }

  // STOP
  if (cmd === "stop") {
    if (!player) return;
    player.destroy();
    message.reply("⛔ Durdu");
  }

  // QUEUE
  if (cmd === "queue") {
    if (!player) return message.reply("Boş");

    message.reply(
      player.queue.map((t, i) => `${i + 1}. ${t.title}`).join("\n")
    );
  }
});

client.login(process.env.TOKEN);
