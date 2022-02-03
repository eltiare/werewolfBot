const { SlashCommandBuilder } = require("@discordjs/builders");
const { commandNames, characters } = require("../util/commandHelpers");
const { channelNames } = require("../util/channelHelpers");
const { roleNames } = require("../util/rolesHelpers");
const { findGame, findUser, updateUser } = require("../werewolf_db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandNames.SEE)
    .setDescription("sees the player's character")
    .setDefaultPermission(false)
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("name of player to investigate")
        .setRequired(true)
    ),
  async execute(interaction) {
    const targetedUser = await interaction.options.getUser("target");
    const game = await findGame(interaction.guild.id);
    const channel = interaction.guild.channels.cache.get(interaction.channelId);
    const targetedMember = interaction.guild.members.cache.get(targetedUser.id);
    const mapRoles = targetedMember.roles.cache;
    const dbUser = await findUser(targetedUser.id, interaction.guild.id);
    const seerUser = await findUser(interaction.user.id, interaction.guild.id);
    const roles = mapRoles.map((role) => {
      return role.name;
    });

    let message;

    // TODO: add more random gifs
    if (!seerUser.see) {
      await interaction.reply({
        content:
          "You are tired. Your gift only works once. Try again next night",
        ephemeral: true,
      });
      return;
    }
    if (channel.name !== channelNames.SEER) {
      await interaction.reply({
        content: "Your magic only works in the seer channel",
        ephemeral: true,
      });
      return;
    }
    if (game.is_day) {
      await interaction.reply({
        content: "It is day time. Your power works at night.",
        ephemeral: true,
      });
      return;
    }
    if (targetedUser.bot) {
      await interaction.reply({
        content: "https://tenor.com/67jg.gif",
        ephemeral: true,
      });
      return;
    }
    if (!roles.includes(roleNames.ALIVE)) {
      await interaction.reply({
        content: "This Person is dead. Focus on the living",
        ephemeral: true,
      });
      return;
    }
    if (
      dbUser.character === characters.SEER &&
      dbUser.id === interaction.user.id
    ) {
      await interaction.reply({
        content: `${targetedUser} is a seer... hmm thats you right? You don't have to investigate to know that! try again.`,
        ephemeral: true,
      });
      return;
    }

    await updateUser(interaction.user.id, interaction.guild.id, { see: false });

    let targetedCharacter = "Villager! Nice someone you can trust";

    if (
      dbUser.character === characters.WEREWOLF ||
      dbUser.character === characters.LYCAN
    ) {
      targetedCharacter = "Werewolf! watch out for this guy.";
    }

    await interaction.reply(
      message ? message : `${targetedUser} is a ${targetedCharacter}`
    );
  },
};
