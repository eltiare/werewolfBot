const _ = require("lodash");
const { createUsers, createGame } = require("../werewolf_db");
const { sendStartMessages, channelNames } = require("./channelHelpers");
const { timeScheduling } = require("./timeHelper");
const { gameCommandPermissions, characters } = require("./commandHelpers");

const roleNames = {
  PLAYING: "Playing",
  ALIVE: "Alive",
  DEAD: "Dead",
};

async function startGame(interaction) {
  const playingUsers = await getPlayingUsers(interaction);
  const users = await giveUserRoles(interaction, playingUsers);
  // if start game returns falsy the bot will reply with an error
  if (!users) {
    return;
  }

  await createChannels(interaction, users);
  // give users character command permissions
  await gameCommandPermissions(interaction, users, true);
  await createGameDocument(interaction);
  await timeScheduling(interaction, "8", "20");
  await sendStartMessages(interaction, users);

  // successfully created game
  return true;
}

async function createGameDocument(interaction) {
  await createGame({
    guild_id: interaction.guild.id,
    is_day: false,
    first_night: true,
    active: true,
    user_death_id: null,
    user_protected_id: null,
    user_guarded_id: null,
  });
}

async function getPlayingUsers(interaction) {
  let playingRole = await getRole(interaction, roleNames.PLAYING);

  if (!playingRole) {
    throw new Error("No playing role created");
  }

  const members = await interaction.guild.members.fetch();
  const playingUsers = members
    .map((member) => {
      if (member._roles.includes(playingRole.id)) {
        return member.user;
      }
    })
    .filter((m) => m);

  if (_.isEmpty(playingUsers)) {
    throw new Error("No Playing Members");
  }

  return playingUsers;
}

async function giveUserRoles(interaction, users) {
  // At least 2 are regular village and Always seer and body guard
  let currentCharacters = [
    characters.SEER,
    characters.BODYGUARD,
    characters.VILLAGER,
    characters.VILLAGER,
  ];
  // TODO: make these characters and add them in commandHelpers
  const leftOverRoles = _.shuffle([
    // characters.APPRENTICE_SEER,
    // characters.FOOL,
    // characters.PRIEST,
    // characters.LYCAN,
    // characters.TRAITOR,
    // characters.MASON,
    // characters.MASON,
    // characters.HUNTER,
  ]);
  numberOfPlayers = users.length;
  numberOfWerewolves = Math.floor(numberOfPlayers / 3);
  leftOverPlayers =
    numberOfPlayers - numberOfWerewolves - currentCharacters.length;

  if (numberOfPlayers < 5) {
    await interaction.reply({
      content: "Error: Not enough players (need at least 5)",
      ephemeral: true,
    });
    return;
  }

  // add werewolves
  for (let i = 0; i < numberOfWerewolves; i++) {
    currentCharacters.push(characters.WEREWOLF);
  }
  // add leftover characters
  for (let i = 0; i < leftOverPlayers; i++) {
    if (!_.isEmpty(leftOverPlayers)) {
      currentCharacters.push(leftOverRoles.pop());
    } else {
      currentCharacters.push(characters.VILLAGER);
    }
  }
  // Mix up characters for game
  currentCharacters = _.shuffle(currentCharacters);

  if (currentCharacters.length !== users.length) {
    await interaction.reply({
      content: "ERROR: Characters do not match users",
      ephemeral: true,
    });
    return;
  }

  // This could be done better fetching for roles twice
  const aliveRole = await getRole(interaction, roleNames.ALIVE);
  const playerRole = await getRole(interaction, roleNames.PLAYING);
  const dbUsers = [];

  users.forEach((user) => {
    // add alive role and remove playing role
    const member = interaction.guild.members.cache.get(user.id);
    member.roles.add(aliveRole);
    member.roles.remove(playerRole);
    // add character
    const newCharacter = _.isEmpty(currentCharacters)
      ? characters.VILLAGER
      : currentCharacters.pop();
    user.character = newCharacter;
    const userInfo = {
      user_id: user.id,
      name: user.username,
      nickname: member.nickname,
      character: newCharacter,
      guild_id: interaction.guild.id,
    };
    switch (newCharacter) {
      case characters.SEER:
        userInfo.see = true;
        break;
      case characters.BODYGUARD:
        userInfo.guard = true;
        userInfo.last_user_guard_id = null;
        break;
      case characters.FOOL:
        userInfo.see = true;
        break;
      case characters.PRIEST:
        userInfo.protect = true;
        userInfo.last_protect_id = null;
        userInfo.holyWater = true;
        break;
    }
    dbUsers.push(userInfo);
  });
  await createUsers(dbUsers);
  return users;
}

async function getRole(interaction, roleName) {
  const roles = await interaction.guild.roles.fetch();

  let foundRole = null;

  roles.forEach((role) => {
    if (role.name === roleName) {
      foundRole = role;
    }
  });
  return foundRole;
}

async function removeAllGameChannels(channels) {
  channels.forEach((channel) => {
    switch (channel.name) {
      case channelNames.TOWN_SQUARE:
      case channelNames.WEREWOLVES:
      case channelNames.SEER:
      case channelNames.MASON:
      case channelNames.AFTER_LIFE:
      case channelNames.THE_TOWN:
      case channelNames.BODYGUARD:
        channel.delete();
    }
  });
}

async function createChannels(interaction, users) {
  const currentChannels = await interaction.guild.channels.fetch();
  // remove old channels
  removeAllGameChannels(currentChannels);

  aliveRole = await getRole(interaction, roleNames.ALIVE);
  deadRole = await getRole(interaction, roleNames.DEAD);

  werewolfUsers = users.filter(
    (user) => user.character === characters.WEREWOLF
  );
  notWerewolfUsers = users.filter(
    (user) => user.character !== characters.WEREWOLF
  );

  nonPlayersPermissions = {
    id: interaction.guild.id,
    deny: ["SEND_MESSAGES", "ADD_REACTIONS"],
    allow: ["VIEW_CHANNEL"],
  };

  deadPermissions = {
    id: deadRole.id,
    deny: ["SEND_MESSAGES", "ADD_REACTIONS"],
    allow: ["VIEW_CHANNEL"],
  };

  denyAlivePermissions = {
    id: aliveRole.id,
    deny: ["SEND_MESSAGES", "VIEW_CHANNEL"],
  };

  townSquarePermissions = [
    nonPlayersPermissions,
    deadPermissions,
    {
      id: aliveRole.id,
      allow: ["SEND_MESSAGES", "VIEW_CHANNEL"],
    },
  ];

  defaultPermissions = [
    deadPermissions,
    denyAlivePermissions,
    nonPlayersPermissions,
  ];

  const werewolvesPermissions = createPermissions(
    users,
    characters.WEREWOLF
  ).concat(defaultPermissions);
  const seerPermissions = createPermissions(users, characters.SEER).concat(
    defaultPermissions
  );
  const masonPermissions = createPermissions(users, characters.MASON).concat(
    defaultPermissions
  );
  const bodyguardPermissions = createPermissions(
    users,
    characters.BODYGUARD
  ).concat(defaultPermissions);

  afterLifePermissions = [
    nonPlayersPermissions,
    {
      id: aliveRole.id,
      deny: ["SEND_MESSAGES", "VIEW_CHANNEL"],
    },
    {
      id: deadRole.id,
      allow: ["SEND_MESSAGES", "VIEW_CHANNEL"],
    },
  ];

  const category = await createCategory(interaction, channelNames.THE_TOWN);
  await createChannel(
    interaction,
    channelNames.TOWN_SQUARE,
    townSquarePermissions,
    category
  );
  await createChannel(
    interaction,
    channelNames.WEREWOLVES,
    werewolvesPermissions,
    category
  );
  await createChannel(
    interaction,
    channelNames.SEER,
    seerPermissions,
    category
  );
  await createChannel(
    interaction,
    channelNames.AFTER_LIFE,
    afterLifePermissions,
    category
  );
  await createChannel(
    interaction,
    channelNames.MASON,
    masonPermissions,
    category
  );
  await createChannel(
    interaction,
    channelNames.BODYGUARD,
    bodyguardPermissions,
    category
  );
}

async function createChannel(interaction, name, permissionOverwrites, parent) {
  return await interaction.guild.channels.create(name, {
    parent,
    type: "GUILD_TEXT",
    permissionOverwrites,
  });
}

async function createCategory(interaction, name) {
  return await interaction.guild.channels.create(name, {
    type: "GUILD_CATEGORY",
  });
}

function createPermissions(users, character) {
  return users
    .map((user) => {
      if (user.character === character) {
        return {
          id: user.id,
          allow: ["SEND_MESSAGES", "VIEW_CHANNEL"],
        };
      }
    })
    .filter((u) => u);
}

module.exports = {
  startGame,
  removeAllGameChannels,
  getPlayingUsers,
  getRole,
  roleNames,
  channelNames,
  characters,
};
