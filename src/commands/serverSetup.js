const { SlashCommandBuilder } = require("@discordjs/builders");
const { commandNames } = require("../util/commandHelpers");
const { permissionCheck } = require("../util/permissionCheck");
const { setupRoles, isAdmin } = require("../util/rolesHelpers");
const { findSettings, createSettings } = require("../werewolf_db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName(commandNames.SERVER_SETUP)
    .setDescription("ADMIN COMMAND: Sets up the server's roles and settings"),
  async execute(interaction) {
    const settings = await findSettings(interaction.guild?.id);
    const deniedMessage = await permissionCheck({
      interaction,
      guildOnly: true,
      check: () => settings && !isAdmin(interaction.member),
    });

    if (deniedMessage) {
      await interaction.reply({
        content: deniedMessage,
        ephemeral: true,
      });
      return;
    }

    await interaction.client.application.fetch();

    await setupRoles(interaction);

    if (!settings) {
      await createSettings({
        guild_id: interaction.guild.id,
        day_time: "8:00",
        night_time: "20:00",
        can_whisper: true,
        allow_reactions: false,
        extra_characters: false,
        // vampire settings
        allow_vampires: false,
        allow_first_bite: false,
        always_bite_two: false,
      });
    }
    await interaction.reply({
      content: "Server is READY!",
      ephemeral: true,
    });
  },
};
