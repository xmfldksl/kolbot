/**
*  @filename    Sorceress.js
*  @author      kolton, theBGuy
*  @desc        Sorceress attack sequence
*
*/

(function (module) {
  module.exports = {
    /** @param {Monster} unit */
    decideSkill: function (unit) {
      let skills = { timed: -1, timedSlot: Attack.getPrimarySlot(), untimed: -1, untimedSlot: Attack.getPrimarySlot() };
      if (!unit || !unit.attackable) return skills;

      let index = (unit.isSpecial || unit.isPlayer) ? 1 : 3;
      let classid = unit.classid;

      // Get timed skill
      let timedEntry = Attack.getCustomAttack(unit)
        ? Attack.getCustomAttack(unit)[0]
        : Config.AttackSkill[index];
      let { skill: checkSkill, slot: checkSlot } = Attack.parseSkillEntry(timedEntry);

      if (Attack.checkResist(unit, checkSkill) && Attack.validSpot(unit.x, unit.y, checkSkill, classid)) {
        skills.timed = checkSkill;
        skills.timedSlot = checkSlot;
      } else {
        let { skill: sec5, slot: sec5Slot } = Attack.parseSkillEntry(Config.AttackSkill[5]);
        if (sec5 > -1
          && Attack.checkResist(unit, sec5)
          && Attack.validSpot(unit.x, unit.y, sec5, classid)) {
          skills.timed = sec5;
          skills.timedSlot = sec5Slot;
        }
      }

      // Get untimed skill
      let untimedEntry = Attack.getCustomAttack(unit)
        ? Attack.getCustomAttack(unit)[1]
        : Config.AttackSkill[index + 1];
      let { skill: checkUntimed, slot: checkUntimedSlot } = Attack.parseSkillEntry(untimedEntry);

      if (Attack.checkResist(unit, checkUntimed) && Attack.validSpot(unit.x, unit.y, checkUntimed, classid)) {
        skills.untimed = checkUntimed;
        skills.untimedSlot = checkUntimedSlot;
      } else {
        let { skill: sec6, slot: sec6Slot } = Attack.parseSkillEntry(Config.AttackSkill[6]);
        if (sec6 > -1
          && Attack.checkResist(unit, sec6)
          && Attack.validSpot(unit.x, unit.y, sec6, classid)) {
          skills.untimed = sec6;
          skills.untimedSlot = sec6Slot;
        }
      }

      // Low mana timed skill
      if (Config.LowManaSkill[0] > -1
        && Skill.getManaCost(skills.timed) > me.mp) {
        let { skill: lmTimed, slot: lmTimedSlot } = Attack.parseSkillEntry(Config.LowManaSkill[0]);
        if (Attack.checkResist(unit, lmTimed)) {
          skills.timed = lmTimed;
          skills.timedSlot = lmTimedSlot;
        }
      }

      // Low mana untimed skill
      if (Config.LowManaSkill[1] > -1
        && Skill.getManaCost(skills.untimed) > me.mp) {
        let { skill: lmUntimed, slot: lmUntimedSlot } = Attack.parseSkillEntry(Config.LowManaSkill[1]);
        if (Attack.checkResist(unit, lmUntimed)) {
          skills.untimed = lmUntimed;
          skills.untimedSlot = lmUntimedSlot;
        }
      }

      return skills;
    },

    /**
    * @param {Monster} unit 
    * @param {boolean} preattack 
    * @returns {AttackResult}
    */
    doAttack: function (unit, preattack = false) {
      if (!unit) return Attack.Result.SUCCESS;
      Config.TeleSwitch && me.switchToPrimary();
      let gid = unit.gid;

      if (Config.MercWatch && me.needMerc()) {
        if (Town.visitTown()) {
          console.log("mercwatch");
          
          if (!unit || !copyUnit(unit).x || !Game.getMonster(-1, -1, gid) || unit.dead) {
            console.debug("Lost reference to unit");
            return Attack.Result.SUCCESS;
          }
        }
      }

      // Keep Energy Shield active
      if (Skill.canUse(sdk.skills.EnergyShield) && !me.getState(sdk.states.EnergyShield)) {
        Skill.cast(sdk.skills.EnergyShield, sdk.skills.hand.Right);
      }

      // Keep Thunder-Storm active
      if (Skill.canUse(sdk.skills.ThunderStorm) && !me.getState(sdk.states.ThunderStorm)) {
        Skill.cast(sdk.skills.ThunderStorm, sdk.skills.hand.Right);
      }

      if (Config.ChargeCast.skill > -1) {
        Attack.doChargeCast(unit);
      }

      if (preattack) {
        let preAttackResult = Attack.doPreAttack(unit);
        if (preAttackResult !== Attack.Result.NOOP) {
          return preAttackResult;
        }
      }

      let useStatic = (Config.StaticList.length > 0
        && Config.CastStatic < 100
        && Skill.canUse(sdk.skills.StaticField)
        && Attack.checkResist(unit, "lightning"));
      let idCheck = function (id) {
        if (unit) {
          switch (true) {
          case typeof id === "number" && unit.classid && unit.classid === id:
          case typeof id === "string" && unit.name && unit.name.toLowerCase() === id.toLowerCase():
          case typeof id === "function" && id(unit):
            return true;
          default:
            return false;
          }
        }

        return false;
      };
  
      // Static - needs to be re-done
      if (useStatic && Config.StaticList.some(id => idCheck(id)) && unit.hpPercent > Config.CastStatic) {
        let staticRange = Skill.getRange(sdk.skills.StaticField);
        let casts = 0;

        while (!me.dead && unit.hpPercent > Config.CastStatic && unit.attackable) {
          if (unit.distance > staticRange || checkCollision(me, unit, sdk.collision.Ranged)) {
            if (!Attack.getIntoPosition(unit, staticRange, sdk.collision.Ranged)) {
              return Attack.Result.FAILED;
            }
          }

          // if we fail to cast or we've casted 3 or more times - do something else
          if (!Skill.cast(sdk.skills.StaticField, sdk.skills.hand.Right) || casts >= 3) {
            break;
          } else {
            casts++;
          }
        }

        // re-check mob after static
        if (!unit || !copyUnit(unit).x || !Game.getMonster(-1, -1, gid) || unit.dead) {
          console.debug("Lost reference to unit");
          return Attack.Result.SUCCESS;
        }
      }

      let skills = this.decideSkill(unit);
      let result = this.doCast(unit, skills.timed, skills.timedSlot, skills.untimed, skills.untimedSlot);

      if (result === Attack.Result.CANTATTACK && Attack.canTeleStomp(unit)) {
        let merc = me.getMerc();
        let mercRevive = 0;

        while (unit.attackable) {
          if (!unit || !copyUnit(unit).x) {
            unit = Misc.poll(() => Game.getMonster(-1, -1, gid), 1000, 80);
          }
          if (!unit) return Attack.Result.SUCCESS;

          if (me.needMerc()) {
            if (Config.MercWatch && mercRevive++ < 1) {
              Town.visitTown();
            } else {
              return Attack.Result.CANTATTACK;
            }

            (merc === undefined || !merc) && (merc = me.getMerc());
          }

          if (!!merc && getDistance(merc, unit) > 7) {
            Pather.moveToUnit(unit);

            let spot = Attack.findSafeSpot(unit, 10, 5, 9);
            !!spot && !!spot.x && Pather.walkTo(spot.x, spot.y);
          }

          let closeMob = Attack.getNearestMonster({ skipGid: gid });
          
          if (!!closeMob) {
            let findSkill = this.decideSkill(closeMob);
            if (this.doCast(closeMob, findSkill.timed, findSkill.timedSlot, findSkill.untimed, findSkill.untimedSlot) !== Attack.Result.SUCCESS) {
              (Skill.haveTK && Packet.telekinesis(unit));
            }
          }
        }

        return Attack.Result.SUCCESS;
      }

      return result;
    },

    afterAttack: function () {
      Precast.doPrecast(false);
    },

    /**
    * @param {Monster | Player} unit
    * @param {number} timedSkill
    * @param {number} timedSlot
    * @param {number} untimedSkill
    * @param {number} untimedSlot
    * @returns {AttackResult} 0 - fail, 1 - success, 2 - no valid attack skills
    */
    doCast: function (unit, timedSkill = -1, timedSlot = Attack.getPrimarySlot(), untimedSkill = -1, untimedSlot = Attack.getPrimarySlot()) {
      // No valid skills can be found
      if (timedSkill < 0 && untimedSkill < 0) return Attack.Result.CANTATTACK;
      // unit became invalidated
      if (!unit || !unit.attackable) return Attack.Result.SUCCESS;
      Config.TeleSwitch && me.switchToPrimary();

      let walk, noMana = false;
      let classid = unit.classid;

      if (timedSkill > -1 && (!me.skillDelay || !Skill.isTimed(timedSkill)) && Skill.getManaCost(timedSkill) < me.mp) {
        if (Skill.getRange(timedSkill) < 4 && !Attack.validSpot(unit.x, unit.y, timedSkill, classid)) {
          return Attack.Result.FAILED;
        }

        if (unit.distance > Skill.getRange(timedSkill) || checkCollision(me, unit, sdk.collision.Ranged)) {
          // Allow short-distance walking for melee skills
          walk = (Skill.getRange(timedSkill) < 4
              && unit.distance < 10
              && !checkCollision(me, unit, sdk.collision.BlockWall)
          );

          if (!Attack.getIntoPosition(unit, Skill.getRange(timedSkill), sdk.collision.Ranged, walk)) {
            return Attack.Result.FAILED;
          }
        }

        if (!unit.dead && !checkCollision(me, unit, sdk.collision.Ranged)) {
          me.weaponswitch !== timedSlot && me.switchWeapons(timedSlot);
          Skill.cast(timedSkill, Skill.getHand(timedSkill), unit);
        }
        return Attack.Result.SUCCESS;
      } else {
        noMana = !me.skillDelay;
      }

      if (untimedSkill > -1 && Skill.getManaCost(untimedSkill) < me.mp) {
        if (Skill.getRange(untimedSkill) < 4 && !Attack.validSpot(unit.x, unit.y, untimedSkill, classid)) {
          return Attack.Result.FAILED;
        }

        if (unit.distance > Skill.getRange(untimedSkill) || checkCollision(me, unit, sdk.collision.Ranged)) {
          // Allow short-distance walking for melee skills
          walk = (Skill.getRange(untimedSkill) < 4
            && unit.distance < 10
            && !checkCollision(me, unit, sdk.collision.BlockWall)
          );

          if (!Attack.getIntoPosition(unit, Skill.getRange(untimedSkill), sdk.collision.Ranged, walk)) {
            return Attack.Result.FAILED;
          }
        }

        if (!unit.dead) {
          me.weaponswitch !== untimedSlot && me.switchWeapons(untimedSlot);
          Skill.cast(untimedSkill, Skill.getHand(untimedSkill), unit);
        }

        return Attack.Result.SUCCESS;
      } else {
        noMana = true;
      }

      // don't count as failed
      if (noMana) return Attack.Result.NEEDMANA;

      Misc.poll(() => !me.skillDelay, 1000, 40);

      return Attack.Result.SUCCESS;
    }
  };
})(module);
