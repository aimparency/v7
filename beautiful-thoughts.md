# a.k.a. mathmatic model

## economics
- cost can be required to be > 0, because an aim with cost 0 would already have been done. 

## value flow
- we calculate value across aims iteratively: 
  - in every iteration we let flow the intrinsic value from thin air into the aims and we let flow the value based on weights between the aims. At the end of the iteration we divide by 2 or normalize such that the value is the sum of inflows. this is the solution for handling loops. We might need to do the reverse for costs (i dont know how cycles are handled right now)
