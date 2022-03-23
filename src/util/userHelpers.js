const _ = require("lodash");
const { getRole, roleNames } = require("../util/rolesHelpers");
const { findManyUsers } = require("../werewolf_db");
const { characters } = require("./commandHelpers");

async function getAliveMembers(interaction, getId) {
  let aliveRole = await getRole(interaction, roleNames.ALIVE);
  const members = await interaction.guild.members.fetch();

  return members
    .map((member) => {
      if (member._roles.includes(aliveRole.id)) {
        if (getId) {
          return member.user.id;
        } else {
          return member;
        }
      }
    })
    .filter((m) => m);
}

async function getAliveUsersIds(interaction) {
  return getAliveMembers(interaction, true);
}

async function castWitchCurse(
  interaction,
  organizedRoles,
  removesDeadPermissions
) {
  const cursorCursed = await findManyUsers({
    guild_id: interaction.guild.id,
    is_cursed: true,
    death: false,
  });
  const cursedPlayers = await cursorCursed.toArray();
  const cursedVillagers = _.filter(cursedPlayers, (player) => {
    return player.character !== characters.WEREWOLF;
  });
  const members = interaction.guild.members.cache;

  const deathCharacters = await Promise.all(
    _.map(cursedVillagers, async (villager) => {
      const villagerMember = members.get(villager.user_id);

      const deadVillager = await removesDeadPermissions(
        interaction,
        villager,
        villagerMember,
        organizedRoles
      );
      let hunterMessage = "";
      if (deadVillager === characters.HUNTER) {
        hunterMessage =
          "you don't have long to live. Grab your gun and `/shoot` someone.";
      }
      return `The ${deadVillager} named ${villagerMember}. ${hunterMessage}\n`;
    })
  );

  if (deathCharacters) {
    return `The witch's curse has killed:\n${deathCharacters}https://tenor.com/NYMC.gif`;
  }
  return "The witch's curse did not kill anyone.\nhttps://tenor.com/TPjK.gif";
}

module.exports = {
  getAliveUsersIds,
  getAliveMembers,
  castWitchCurse,
};
