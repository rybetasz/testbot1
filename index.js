require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

const play = require("play-dl");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = process.env.PREFIX;
const queues = new Map();

// ---------------- READY ----------------
client.once("clientReady", () => {
  console.log(`${client.user.tag} hazır`);
});

// ---------------- PLAY FUNCTION ----------------
async function playSong(guild) {
  const queue = queues.get(guild.id);
  if (!queue) return;

  if (queue.songs.length === 0) {
    queue.connection.destroy();
    queues.delete(guild.id);
    return;
  }

  const song = queue.songs[0];

  try {
    const stream = await play.stream(song.url);

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    queue.player.play(resource);
  } catch (err) {
    console.log("Stream error:", err);
    queue.songs.shift();
    playSong(guild);
  }
}

// ---------------- MESSAGE ----------------
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (!message.content.startsWith(prefix)) return;

  // ================= PLAY =================
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Önce voice’a gir.");

    const url = args[0];
    if (!url) return message.reply("Link gir.");

    let queue = queues.get(message.guild.id);

    if (!queue) {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      const connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      queue = {
        connection,
        player,
        songs: [],
      };

      queues.set(message.guild.id, queue);

      connection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        playSong(message.guild);
      });

      player.on("error", (err) => {
        console.log("Player error:", err);
        queue.songs.shift();
        playSong(message.guild);
      });
    }

    queue.songs.push({ url });

    message.channel.send(`🎶 Eklendi: ${url}`);

    if (queue.songs.length === 1) {
      playSong(message.guild);
    }
  }

  // ================= SKIP =================
  if (cmd === "skip") {
    const queue = queues.get(message.guild.id);
    if (!queue) return message.reply("Queue boş.");

    queue.player.stop();
    message.channel.send("⏭ Skip atıldı");
  }

  // ================= QUEUE =================
  if (cmd === "queue") {
    const queue = queues.get(message.guild.id);
    if (!queue) return message.reply("Queue boş.");

    message.channel.send(
      queue.songs.map((s, i) => `${i + 1}. ${s.url}`).join("\n")
    );
  }

  // ================= STOP =================
  if (cmd === "stop") {
    const queue = queues.get(message.guild.id);
    if (!queue) return;

    queue.songs = [];
    queue.player.stop();
    queue.connection.destroy();
    queues.delete(message.guild.id);

    message.channel.send("⛔ Durdu ve çıktı");
  }
});

client.login(process.env.TOKEN);
