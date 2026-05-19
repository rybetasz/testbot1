require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");
const ytdl = require("ytdl-core");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";
const queues = new Map();

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
    });
  }
  return queues.get(guildId);
}

async function playSong(guildId) {
  const queue = getQueue(guildId);
  const song = queue.songs[0];
  if (!song) return;

  const stream = ytdl(song.url, {
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  });

  const resource = createAudioResource(stream);

  queue.player.play(resource);
}

client.once("ready", () => {
  console.log("Bot hazır");
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(1).split(/ +/);
  const cmd = args.shift();

  const queue = getQueue(message.guild.id);

  // PLAY
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const search = args.join(" ");
    if (!search) return message.reply("şarkı yaz");

    let url = search;

    if (!search.includes("youtube.com") && !search.includes("youtu.be")) {
      const yts = require("yt-search");
      const result = await yts(search);
      url = result.videos[0].url;
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
    }

    queue.songs.push({ url });

    message.reply("➕ eklendi");

    if (queue.songs.length === 1) {
      playSong(message.guild.id);
    }
  }

  // SKIP
  if (cmd === "skip") {
    queue.player.stop();
    message.reply("⏭ skip");
  }

  // STOP
  if (cmd === "stop") {
    queue.songs = [];
    queue.connection?.destroy();
    queues.delete(message.guild.id);
    message.reply("⛔ stop");
  }

  // QUEUE
  if (cmd === "queue") {
    message.reply(queue.songs.map((s, i) => `${i + 1}. ${s.url}`).join("\n"));
  }
});

client.login(process.env.TOKEN);
