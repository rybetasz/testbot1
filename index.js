require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const { Innertube } = require("youtubei.js");
const { exec } = require("child_process");

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

const player = createAudioPlayer();

client.once("ready", async () => {
  console.log("Bot hazır");
  youtube = await Innertube.create();
});

async function playSong(voiceChannel, url, connection) {
  const streamUrl = `https://www.youtube.com/watch?v=${url}`;

  const stream = createAudioResource(streamUrl, {
    inputType: require("@discordjs/voice").StreamType.Arbitrary,
  });

  player.play(stream);
  connection.subscribe(player);
}

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(1).split(/ +/);
  const cmd = args.shift();

  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const search = args.join(" ");

    const result = await youtube.search(search);
    const video = result.videos[0];

    const connection = joinVoiceChannel({
      channelId: voice.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    const stream = require("child_process").spawn("yt-dlp", [
      "-f",
      "bestaudio",
      "-o",
      "-",
      video.url,
    ]);

    const resource = createAudioResource(stream.stdout, {
      inputType: require("@discordjs/voice").StreamType.OggOpus,
    });

    player.play(resource);
    connection.subscribe(player);

    message.reply(`🎧 Çalıyor: ${video.title}`);
  }

  if (cmd === "skip") {
    player.stop();
    message.reply("⏭ Skip");
  }
});

client.login(process.env.TOKEN);
