require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");
const { Innertube } = require("youtubei.js");
const play = require("play-dl");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

let youtube;
const queues = new Map();

/* ---------------- INIT ---------------- */

client.once("ready", async () => {
  console.log("Bot hazır");
  youtube = await Innertube.create();
});

/* ---------------- QUEUE ---------------- */

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      player: createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      }),
      connection: null,
      playing: false,
    });
  }
  return queues.get(guildId);
}

/* ---------------- AUDIO (STABLE FIX) ---------------- */

async function playSong(guildId) {
  const queue = getQueue(guildId);
  const song = queue.songs[0];
  if (!song) return;

  try {
    const stream = await play.stream(song.url);

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    queue.player.play(resource);
    queue.playing = true;
  } catch (err) {
    console.log("STREAM ERROR:", err);
    queue.songs.shift();
    playSong(guildId);
  }
}

/* ---------------- EVENTS ---------------- */

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const queue = getQueue(message.guild.id);

  /* -------- PLAY -------- */
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const query = args.join(" ");
    if (!query) return message.reply("Şarkı yaz");

    let video;

    try {
      // LINK
      if (query.includes("youtube.com") || query.includes("youtu.be")) {
        video = { title: "YouTube Link", url: query };
      } else {
        const search = await youtube.search(query);
        video = {
          title: search.videos[0].title,
          url: search.videos[0].url,
        };
      }

      if (!queue.connection) {
        queue.connection = joinVoiceChannel({
          channelId: voice.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });

        queue.connection.subscribe(queue.player);

        queue.player.on(AudioPlayerStatus.Idle, () => {
          queue.songs.shift();
          playSong(message.guild.id);
        });

        queue.player.on("error", (e) => {
          console.log("PLAYER ERROR:", e);
          queue.songs.shift();
          playSong(message.guild.id);
        });
      }

      queue.songs.push(video);

      message.reply(`➕ Eklendi: **${video.title}**`);

      if (!queue.playing) playSong(message.guild.id);
    } catch (err) {
      console.log("PLAY ERROR:", err);
      message.reply("❌ Şarkı alınamadı (YouTube block)");
    }
  }

  /* -------- SKIP -------- */
  if (cmd === "skip") {
    queue.player.stop();
    message.reply("⏭ Skip");
  }

  /* -------- STOP -------- */
  if (cmd === "stop") {
    queue.songs = [];
    queue.connection?.destroy();
    queues.delete(message.guild.id);
    message.reply("⛔ Durdu");
  }

  /* -------- QUEUE -------- */
  if (cmd === "queue") {
    if (!queue.songs.length) return message.reply("Boş");

    message.reply(
      queue.songs.map((s, i) => `${i + 1}. ${s.title}`).join("\n")
    );
  }
});

client.login(process.env.TOKEN);
